import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';
import { readProjectSessions, type ProjectSessionsFile } from '../../lib/project-sessions.js';
import { isProjectDirName } from '../../lib/project-name.js';
import { projectLocate } from '../project/locate.js';
import type { LocateResult } from '@rad-orchestration/work-graph';
import { computeActiveTimeMs } from '@rad-orchestration/telemetry';

const DEFAULT_LIMIT = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionListRow {
  sessionId: string;
  name: string;
  harness: string;
  cwd: string;
  createdAt: string;
  lastSeenAt: string;
  types: string[]; // distinct types across the trail
  activity: { type: string; description: string; at: string }[];
  activeTimeMs: number;
}

export interface SessionListResult {
  project: string;
  total: number;
  /** Summed across every matching session, independent of --limit. */
  totalActiveTimeMs: number;
  rows: SessionListRow[];
}

export interface SessionListDeps {
  readProjectSessions: (projectDir: string) => ProjectSessionsFile;
  computeActiveTimeMs: (opts: { root: string; sessionId: string }) => number;
  /** Injection seam for `projectLocate`'s cwd-fallback — tests never touch a real ~/.radorc. */
  locator?: (cwd: string) => LocateResult;
}

export interface SessionListOptions extends SessionListDeps {
  projectsRoot: string;
  telemetryRoot: string;
  project?: string;
  type?: string;
  limit?: number;
  all?: boolean;
  cwd: string;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/** Resolves `--project` from the cwd via the shared locate path; a main-clone or
 *  unresolvable cwd is an actionable user error rather than a guess. */
function resolveProject(opts: SessionListOptions): string {
  if (opts.project) {
    if (!isProjectDirName(opts.project)) {
      throw new UserError(
        `--project "${opts.project}" is not a valid project directory name; expected an uppercase letter or digit followed by uppercase letters, digits, hyphens, or dots (e.g. AIOPS-123)`,
      );
    }
    return opts.project;
  }

  const located = projectLocate({ cwd: opts.cwd, locator: opts.locator });
  if (located.kind === 'side-project' && located.worktree_name) {
    return located.worktree_name;
  }
  if (located.kind === 'worktree' && located.projects?.length === 1) {
    return located.projects[0]!;
  }
  throw new UserError('Could not resolve a project from the current directory; supply --project explicitly.');
}

/**
 * List a project's saved sessions, newest-first by `lastSeenAt`, optionally
 * filtered by activity type and capped to `--limit` rows unless `--all`.
 */
export function sessionList(opts: SessionListOptions): SessionListResult {
  const project = resolveProject(opts);
  const projectDir = path.join(opts.projectsRoot, project);
  const file = opts.readProjectSessions(projectDir);

  const matching = file.sessions
    .filter((s) => !opts.type || s.activity.some((a) => a.type === opts.type))
    .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0));

  const total = matching.length;
  const limited = opts.all ? matching : matching.slice(0, opts.limit ?? DEFAULT_LIMIT);

  // Active time is read per session out of the telemetry usage partitions, computed
  // once per matching session and reused for both a row's own figure and the
  // project total below — `limited` is always a subset of `matching`, so computing
  // per row and again per total would read every surviving session's partitions twice.
  const activeTimeById = new Map<string, number>(
    matching.map((s) => [s.sessionId, opts.computeActiveTimeMs({ root: opts.telemetryRoot, sessionId: s.sessionId })]),
  );

  const rows: SessionListRow[] = limited.map((s) => ({
    sessionId: s.sessionId,
    name: s.name,
    harness: s.harness,
    cwd: s.cwd,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    types: Array.from(new Set(s.activity.map((a) => a.type))),
    activity: s.activity.map((a) => ({ type: a.type, description: a.description, at: a.at })),
    activeTimeMs: activeTimeById.get(s.sessionId) ?? 0,
  }));

  // Unlike a row's activeTimeMs, the project total is deliberately limit-independent:
  // it sums every matching session so it reflects the whole project's history, not just
  // the page --limit hands back. A session with no telemetry contributes 0.
  const totalActiveTimeMs = matching.reduce(
    (sum, s) => sum + (activeTimeById.get(s.sessionId) ?? 0),
    0,
  );

  return { project, total, totalActiveTimeMs, rows };
}

// ── Command definition ────────────────────────────────────────────────────────

export function sessionListWithDefaults(args: {
  project?: string;
  type?: string;
  limit?: number;
  all?: boolean;
  cwd: string;
}): SessionListResult {
  const paths = userDataPaths();
  return sessionList({
    ...args,
    projectsRoot: paths.projects,
    telemetryRoot: paths.telemetry,
    readProjectSessions,
    computeActiveTimeMs,
  });
}

interface Args { project?: string; type?: string; limit?: string }
interface Flags { all?: boolean }

export const sessionListCommand = defineCommand({
  name: 'session-list',
  description: "List a project's saved sessions with their activity trail and active time",
  args: {
    project: { description: 'Project name; when omitted, resolved from the current working directory' },
    type: { description: 'Filter to sessions whose trail includes one of: brainstorming, requirements, master-plan, amend, execution, other, execution-complete, final-approved, final-rejected, halted, corrective; all types by default' },
    limit: { description: 'Maximum rows to return, newest first by last-seen time; defaults to 10; --all ignores this limit', default: String(DEFAULT_LIMIT) },
  },
  flags: {
    all: { description: 'Return every session for the project, ignoring --limit', type: 'boolean' },
  },
  handler: async ({ args, flags }: { args: Args; flags: Flags; ctx: CommandContext }) => {
    return sessionListWithDefaults({
      project: args.project,
      type: args.type,
      limit: args.limit !== undefined ? Number(args.limit) : undefined,
      all: flags.all ?? false,
      cwd: process.cwd(),
    });
  },
  mapResult: (r: SessionListResult) => ({ ok: true as const, data: r }),
});
