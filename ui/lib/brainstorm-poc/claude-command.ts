// Builds the shell command for one Claude Code turn. The message is NOT placed
// here — it is fed via stdin so arbitrary user text never needs shell escaping.
// sessionId is a validated UUID, so interpolation is injection-safe.
export interface ClaudeCommandInput {
  sessionId: string;
  isFirstTurn: boolean;
}

export function buildClaudeCommand({ sessionId, isFirstTurn }: ClaudeCommandInput): string {
  // --session-id is create-only (turn 1); --resume continues every later turn (AD-2).
  const sessionFlag = isFirstTurn ? `--session-id ${sessionId}` : `--resume ${sessionId}`;
  // A normal session: hooks, CLAUDE.md, skills, memory, and tools all load (no --safe-mode,
  // no --tools "") — so the background agent behaves like an interactive CLI session. Staying
  // on the Max plan is guaranteed by stripping metered credentials in buildChildEnv, NOT by
  // these flags (auth/billing is orthogonal to config + tools).
  // --permission-mode auto lets the headless session act on tool calls without an interactive
  // prompt (which it can't show); JSON output is read for the `result` field (AD-3, FR-7).
  return `claude -p ${sessionFlag} --permission-mode auto --output-format json`;
}
