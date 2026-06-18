// Pure session-turn logic for the Brainstorm POC. No I/O, no globals.
export interface SessionState {
  sessionId: string | null;
  established: boolean;
}

export interface SessionStoreApi {
  getState: () => SessionState;
  setState: (state: SessionState) => void;
  reset: () => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

// Decide whether this turn mints a new session (--session-id) or continues an
// existing one (--resume). A client-supplied id always resumes that id — the
// portability / hijack probe (FR-5, AD-2).
export function resolveTurn(
  state: SessionState,
  clientSessionId: string | undefined,
  mint: () => string,
): { sessionId: string; isFirstTurn: boolean; nextState: SessionState } {
  if (clientSessionId && clientSessionId.trim()) {
    const id = clientSessionId.trim();
    return { sessionId: id, isFirstTurn: false, nextState: { sessionId: id, established: true } };
  }
  if (!state.sessionId || !state.established) {
    const id = state.sessionId ?? mint();
    return { sessionId: id, isFirstTurn: true, nextState: { sessionId: id, established: true } };
  }
  return { sessionId: state.sessionId, isFirstTurn: false, nextState: state };
}

// Reset to a fresh, not-yet-created session (the "New session" action, FR-5).
export function mintFreshSession(
  mint: () => string,
): { sessionId: string; nextState: SessionState } {
  const id = mint();
  return { sessionId: id, nextState: { sessionId: id, established: false } };
}
