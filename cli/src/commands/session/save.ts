import fs from 'node:fs';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError, SystemError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';
import { isProjectDirName } from '../../lib/project-name.js';
import { HARNESSES, type Harness } from '../../lib/harness.js';
import {
  readProjectSessions,
  upsertProjectSession,
  type ProjectSessionsFile,
  type UpsertInput,
  type UpsertResult,
} from '../../lib/project-sessions.js';
import {
  writeProjectIndexEntry, lookupSessionProject, computeActiveTimeMs,
  type ProjectSessionIndexEntry,
} from '@rad-orchestration/telemetry';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionSaveResult {
  sessionId: string;
  project: string; // the REQUESTED project, on every path
  conflict?: { sessionId: string; existingProject: string; requestedProject: string; message: string };
  name?: string; // present only when an entry was written
  type?: string; // present only when an entry was written
  created?: boolean; // true when this call created the entry
  projectCreated?: boolean; // true when this call created the project folder
  activityCount?: number;
  activeTimeMs?: number; // 0 when telemetry has nothing for this session
}

export interface SessionSaveDeps {
  /** Creates the project folder when absent; returns true when this call created it. */
  ensureProjectDir: (projectDir: string) => boolean;
  readProjectSessions: (projectDir: string) => ProjectSessionsFile;
  upsertProjectSession: (projectDir: string, input: UpsertInput) => UpsertResult;
  lookupSessionProject: (telemetryRoot: string, sessionId: string) => string | null;
  writeProjectIndexEntry: (telemetryRoot: string, e: { sessionId: string; project: string; now?: Date }) => ProjectSessionIndexEntry;
  computeActiveTimeMs: (opts: { root: string; sessionId: string }) => number;
  now: () => Date;
}

export interface SessionSaveOptions extends SessionSaveDeps {
  projectsRoot: string;
  telemetryRoot: string;
  project: string;
  sessionId: string;
  description: string;
  harness: string;
  name?: string;
  type?: string;
  cwd: string;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Save one activity entry for a session — creating its project folder and record
 * when this is the session's first save, appending otherwise.
 *
 * A session already attributed to a different project is a human judgment call
 * (a conversation can genuinely span two projects), so that path stops short:
 * it returns `data.conflict` on an otherwise-ok envelope and writes nothing.
 * That only applies while the claim is backed by the claimed project's own
 * record — an index entry pointing at a project that no longer carries the
 * session is stale, and the save proceeds, re-pointing the index.
 */
export function sessionSave(opts: SessionSaveOptions): SessionSaveResult {
  if (!isProjectDirName(opts.project)) {
    throw new UserError(
      `--project "${opts.project}" is not a valid project directory name; expected an uppercase letter or digit followed by uppercase letters, digits, hyphens, or dots (e.g. AIOPS-123)`,
    );
  }
  // An empty id would key a record and an index entry nothing can resolve back, and the
  // framework's required-arg guard only rejects an absent flag, so `--session ""` reaches here.
  if (!opts.sessionId.trim()) {
    throw new UserError('--session must be a non-empty session ID; take it from the session preamble.');
  }
  if (!(HARNESSES as readonly string[]).includes(opts.harness)) {
    throw new UserError(`--harness must be one of: ${HARNESSES.join(', ')} (got "${opts.harness}")`);
  }
  const harness = opts.harness as Harness;

  const existingProject = opts.lookupSessionProject(opts.telemetryRoot, opts.sessionId);
  if (existingProject !== null && existingProject !== opts.project) {
    // A malformed claim reads as stale rather than throwing: it came from our own
    // index, and short-circuiting keeps it out of the path join below.
    const claimStillHeld =
      isProjectDirName(existingProject) &&
      opts
        .readProjectSessions(path.join(opts.projectsRoot, existingProject))
        .sessions.some((s) => s.sessionId === opts.sessionId);

    if (claimStillHeld) {
      const message =
        `Session "${opts.sessionId}" is already attributed to project "${existingProject}", but this save requested project "${opts.project}". ` +
        'Ask the operator which project this session belongs to before saving again.';
      return {
        sessionId: opts.sessionId,
        project: opts.project,
        conflict: { sessionId: opts.sessionId, existingProject, requestedProject: opts.project, message },
      };
    }
  }

  const projectDir = path.join(opts.projectsRoot, opts.project);

  // Peeked before creating anything: an absent project folder reads as no prior
  // sessions, so a first save missing --name fails without ever touching disk.
  const prior = opts.readProjectSessions(projectDir);
  const hasExisting = prior.sessions.some((s) => s.sessionId === opts.sessionId);
  if (!hasExisting && !opts.name?.trim()) {
    throw new UserError('A name is required on first save; pass --name to create this session entry.');
  }

  const projectCreated = opts.ensureProjectDir(projectDir);

  const now = opts.now();
  const type = opts.type ?? 'other';
  const result = opts.upsertProjectSession(projectDir, {
    sessionId: opts.sessionId,
    name: opts.name,
    cwd: opts.cwd,
    harness,
    activity: { type, description: opts.description },
    now,
  });

  if (!result.ok) {
    throw new UserError('A name is required on first save; pass --name to create this session entry.');
  }

  // The project-folder record is authoritative and is never rolled back on an index
  // write failure — a later save repairs the index. No transaction here on purpose.
  try {
    opts.writeProjectIndexEntry(opts.telemetryRoot, { sessionId: opts.sessionId, project: opts.project, now });
  } catch (err) {
    throw new SystemError(`Session record was written but the telemetry index write failed: ${(err as Error).message}`);
  }

  const activeTimeMs = opts.computeActiveTimeMs({ root: opts.telemetryRoot, sessionId: opts.sessionId });

  return {
    sessionId: opts.sessionId,
    project: opts.project,
    name: result.entry.name,
    type,
    created: result.created,
    projectCreated,
    activityCount: result.entry.activity.length,
    activeTimeMs,
  };
}

// ── Command definition ────────────────────────────────────────────────────────

function ensureProjectDirDefault(projectDir: string): boolean {
  if (fs.existsSync(projectDir)) return false;
  fs.mkdirSync(projectDir, { recursive: true });
  return true;
}

export function sessionSaveWithDefaults(args: {
  project: string;
  sessionId: string;
  description: string;
  harness: string;
  name?: string;
  type?: string;
  cwd?: string;
}): SessionSaveResult {
  const paths = userDataPaths();
  return sessionSave({
    project: args.project,
    sessionId: args.sessionId,
    description: args.description,
    harness: args.harness,
    name: args.name,
    type: args.type,
    cwd: args.cwd ?? process.cwd(),
    projectsRoot: paths.projects,
    telemetryRoot: paths.telemetry,
    ensureProjectDir: ensureProjectDirDefault,
    readProjectSessions,
    upsertProjectSession,
    lookupSessionProject,
    writeProjectIndexEntry,
    computeActiveTimeMs,
    now: () => new Date(),
  });
}

interface Args {
  project: string;
  session: string;
  description: string;
  harness: string;
  name?: string;
  type?: string;
  cwd?: string;
}

export const sessionSaveCommand = defineCommand({
  name: 'session-save',
  description: 'Save one activity entry for a session, creating its project and record on first save',
  args: {
    project: { description: 'Required. Target project name; the folder is created when it does not exist', required: true },
    session: { description: 'Required. Session ID, taken from the preamble', required: true },
    description: { description: 'Required. What happened this time, in 1-2 sentences, high-level; becomes one activity entry', required: true },
    harness: { description: 'Required. Harness that ran the session: claude or copilot', required: true },
    name: { description: 'The session\'s handle; required only when the entry is being created' },
    type: { description: 'Activity type: brainstorming, requirements, master-plan, amend, execution, other, execution-complete, final-approved, final-rejected, halted, or corrective; an unrecognized value is accepted and stored as-is; defaults to other', default: 'other' },
    cwd: { description: 'Launch directory recorded for resume; defaults to the current working directory' },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    return sessionSaveWithDefaults({
      project: args.project,
      sessionId: args.session,
      description: args.description,
      harness: args.harness,
      name: args.name,
      type: args.type,
      cwd: args.cwd,
    });
  },
  mapResult: (r: SessionSaveResult) => ({ ok: true as const, data: r }),
});
