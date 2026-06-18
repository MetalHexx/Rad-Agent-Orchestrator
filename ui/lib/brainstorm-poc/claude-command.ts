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
  // --safe-mode = vanilla (no hooks/CLAUDE.md/skills/memory) while OAuth auth still works;
  // --tools "" disables all built-in tools; JSON output is read for the `result` field (AD-3, FR-7).
  return `claude -p ${sessionFlag} --safe-mode --tools "" --output-format json`;
}
