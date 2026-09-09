import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';
import { readProjectSessions, type ProjectSessionsFile } from '../../lib/project-sessions.js';
import { HARNESSES, type Harness } from '../../lib/harness.js';
import { lookupSessionProject } from '@rad-orchestration/telemetry';
import {
  launchTerminal,
  type LaunchAgent,
  type TerminalLaunchOptions,
  type TerminalLaunchResult,
} from '@rad-orchestration/terminal-launch';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionResumeResult {
  sessionId: string;
  project: string;
  cwd: string;
  harness: string;
  launched: boolean;
  reason?: string; // set when launched === false
}

export interface SessionResumeDeps {
  lookupSessionProject: (telemetryRoot: string, sessionId: string) => string | null;
  readProjectSessions: (projectDir: string) => ProjectSessionsFile;
  /** Injection seam for the launcher — tests never spawn a real terminal. */
  launch: (opts: TerminalLaunchOptions) => TerminalLaunchResult;
}

export interface SessionResumeOptions extends SessionResumeDeps {
  projectsRoot: string;
  telemetryRoot: string;
  sessionId: string;
  harness?: string;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Resolve a saved session to its recorded project and launch directory, then
 * reopen a terminal there resuming that session's conversation.
 *
 * The launch directory check now lives in `@rad-orchestration/terminal-launch`
 * (`launchTerminal` refuses before spawning and reports `error`), so this
 * function no longer probes the filesystem itself — attempt-and-degrade for
 * both harnesses, the same posture this codebase takes elsewhere when a
 * harness-specific signal is unavailable.
 *
 * Verified Copilot resume facts (v1.0.80), recorded here so nobody re-derives
 * them: `copilot --resume=<uuid>` is correct as written — the identifier is a
 * session UUID (a task id, a 7+ char prefix, and an exact session name also
 * bind, but the UUID is what we hold); bare `--resume` opens an interactive
 * picker rather than resuming the latest session (`--continue` is that); and
 * Copilot `cd`s itself into the session's own recorded directory on resume
 * unless `COPILOT_DISABLE_RESUME_AUTO_CD=1`, so for Copilot the directory we
 * launch in is advisory.
 */
export function sessionResume(opts: SessionResumeOptions): SessionResumeResult {
  const project = opts.lookupSessionProject(opts.telemetryRoot, opts.sessionId);
  if (project === null) {
    throw new UserError(`Session "${opts.sessionId}" is not attributed to any project; it may never have been saved.`);
  }

  const projectDir = path.join(opts.projectsRoot, project);
  const file = opts.readProjectSessions(projectDir);
  const entry = file.sessions.find((s) => s.sessionId === opts.sessionId);
  if (!entry) {
    throw new UserError(`Session "${opts.sessionId}" is indexed to project "${project}" but that project has no matching session record; the index may be stale.`);
  }

  const requestedHarness = opts.harness ?? entry.harness;
  if (!(HARNESSES as readonly string[]).includes(requestedHarness)) {
    throw new UserError(`--harness must be one of: ${HARNESSES.join(', ')} (got "${requestedHarness}")`);
  }
  const harness = requestedHarness as Harness;

  const base = { sessionId: opts.sessionId, project, cwd: entry.cwd, harness };

  const r = opts.launch({ agent: harness as LaunchAgent, cwd: entry.cwd, resumeSessionId: opts.sessionId });
  if (!r.ok) return { ...base, launched: false, reason: r.error ?? 'Launch failed' };
  return { ...base, launched: true };
}

// ── Command definition ────────────────────────────────────────────────────────

export function sessionResumeWithDefaults(args: { sessionId: string; harness?: string }): SessionResumeResult {
  const paths = userDataPaths();
  return sessionResume({
    sessionId: args.sessionId,
    harness: args.harness,
    projectsRoot: paths.projects,
    telemetryRoot: paths.telemetry,
    lookupSessionProject,
    readProjectSessions,
    launch: launchTerminal,
  });
}

interface Args {
  session: string;
  harness?: string;
}

export const sessionResumeCommand = defineCommand({
  name: 'session-resume',
  description: 'Reopen a terminal into a saved session, resuming its conversation',
  args: {
    session: { description: 'Session ID to resume; resolved to its project and launch directory via the saved record', required: true },
    harness: { description: 'Override the recorded harness for this launch: claude or copilot' },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    return sessionResumeWithDefaults({ sessionId: args.session, harness: args.harness });
  },
  mapResult: (r: SessionResumeResult) => ({ ok: true as const, data: r }),
});
