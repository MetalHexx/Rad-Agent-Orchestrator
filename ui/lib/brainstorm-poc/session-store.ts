import type { SessionState, SessionStoreApi } from './session-logic';

// In-memory only: state lives in this module for the life of the server process.
// A restart resets to a fresh chat — the POC keeps no store of its own (NFR-3).
export function createSessionStore(initial?: SessionState): SessionStoreApi {
  let state: SessionState = initial ?? { sessionId: null, established: false };
  return {
    getState: () => state,
    setState: (next) => { state = next; },
    reset: () => { state = { sessionId: null, established: false }; },
  };
}

// The single shared session for the running server (AD-6).
export const sessionStore = createSessionStore();
