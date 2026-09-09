import type { LaunchAgent } from './launch.js';

/**
 * Per-agent marker predicates for {@link sanitizeLaunchEnv}. One table, one
 * place to add a second harness's markers.
 *
 * Copilot's set is deliberately empty today. Copilot sets `COPILOT_SUPERVISED`
 * and `COPILOT_LOADER_PID` on its own process tree and strips exactly those
 * two when launching a user's `!` shell escape — but whether they reach a
 * session spawned from *inside* a live Copilot session is unverified, and it
 * can only be settled by running a command inside one. No behaviour changes
 * on a guess; see the open item in this package's AGENTS.md.
 */
const MARKERS: Record<LaunchAgent, (key: string) => boolean> = {
  claude: (k) => k === 'CLAUDECODE' || /^CLAUDE_CODE_/.test(k),
  copilot: () => false,
  vscode: () => false,
  terminal: () => false,
};

/**
 * Build the env for a launched agent so the new session comes up TOP-LEVEL,
 * not as a nested child of the session that spawned it.
 *
 * Claude Code marks a spawned process a *child session* when it inherits the
 * parent's `CLAUDECODE` / `CLAUDE_CODE_*` markers, and child sessions do not
 * write the flat `<session>.jsonl` transcript that telemetry reads — so
 * worktree/pipeline sessions captured nothing. Stripping exactly those
 * markers makes every claude launch a fresh top-level session. Everything
 * else is preserved (PATH, HOME, and notably `CLAUDE_EFFORT`, which is not a
 * `CLAUDE_CODE_` var). Never mutates the input env object.
 */
export function sanitizeLaunchEnv(agent: LaunchAgent, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const strip = MARKERS[agent];
  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(out)) {
    if (strip(key)) delete out[key];
  }
  return out;
}
