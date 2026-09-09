import { defineCommand } from '../../framework/command.js';
import { userDataPaths } from '../../lib/paths.js';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import { normalizeAmbientVerbosity } from '../../lib/ambient-verbosity.js';
import { readConfig } from '../config/index.js';
import { readSelectedStyle } from '../../lib/communication-style.js';
import { renderPreamble } from './render.js';
import { resolveStanding } from './resolve.js';
import type { CommandContext } from '../../framework/context.js';

interface Flags { verbosity?: string; session?: string; cwd?: string; harness?: string }

export const sessionContextCommand = defineCommand({
  name: 'session-context',
  description: 'Rendered session preamble for orchestrator session initialization',
  args: {},
  flags: {
    verbosity: {
      description: 'Override the configured ambient_awareness.verbosity for this render only (verbose|minimal|silent|off); never persists',
      type: 'string',
    },
    session: {
      description: 'The session ID reported by the harness at session start',
      type: 'string',
    },
    cwd: {
      description: 'The launch directory reported by the harness at session start',
      type: 'string',
    },
    harness: {
      description: 'The harness the session is running under (claude|copilot)',
      type: 'string',
    },
  },
  handler: async ({ flags }: { args: Record<string, never>; flags: Flags; ctx: CommandContext }) => {
    const paths = userDataPaths();
    const root = paths.root;
    // Worktree *paths* are derived from state.json + the worktree-name convention; only
    // branch/existence need git, which the preamble does not read here, so pass a no-op exec
    // to avoid spawning `git worktree list` per repo at session start. worktreesDir is passed
    // for single-authority parity with `project show` / `project worktrees` — closes the seam
    // even though it is path-equivalent today.
    const svc = new WorkGraphService({
      root,
      worktreesDir: paths.worktrees,
      sideProjectsDir: paths.sideProjects,
      exec: () => '',
    });
    const projects = svc.listProjects({ status: 'in_progress' });
    const active = projects.map((p) => ({ name: p.name, stateLabel: p.stateLabel }));
    let activePortfolios: string[] = [];
    try {
      activePortfolios = svc.listPortfolios({ status: 'active' }).map((p) => p.name);
    } catch { /* session-start must never throw */ }
    const config = readConfig({ root });
    // An unrecognized --verbosity degrades to a fixed fallback level rather than erroring:
    // this command feeds session start and must never throw.
    const verbosity = normalizeAmbientVerbosity(flags.verbosity ?? config.ambientVerbosity);
    let style: { name: string; body: string } | null = null;
    try {
      if (config.communicationStyle.enabled) {
        const parsed = readSelectedStyle(paths.communicationStyles, config.communicationStyle.selected);
        if (parsed) style = { name: parsed.name, body: parsed.body };
      }
    } catch { /* session-start must never throw */ }
    const standing = resolveStanding({ cwd: process.cwd(), worktreesDir: paths.worktrees });
    // The session id alone gates the row: cwd and harness identify nothing on their own,
    // and the shim always passes --harness (it defaults to 'claude'), so keying off any
    // flag would render a hollow Session row carrying an empty id for a payload the hook
    // could not parse. A preamble with no session identity is the required degradation.
    const identity = flags.session
      ? { sessionId: flags.session, cwd: flags.cwd ?? '', harness: flags.harness ?? '' }
      : undefined;
    return { preamble: renderPreamble({ root, active, config, standing, verbosity, style, identity, activePortfolios }) };
  },
});
