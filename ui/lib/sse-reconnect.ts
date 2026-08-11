// Pure backoff policy for the shared SSE connection's reconnect schedule.
// Kept separate from use-sse.ts so the escalation/cap/reset behavior is
// testable without waiting on real timers.

export const BACKOFF_INITIAL_MS = 1000;
export const BACKOFF_MAX_MS = 30000;
const BACKOFF_MULTIPLIER = 2;

/** The delay before the next attempt. `prevDelayMs` is null before the first retry.
 *  Always returns a delay — there is no give-up value, by design. */
export function nextReconnectDelay(prevDelayMs: number | null): number {
  if (prevDelayMs === null) return BACKOFF_INITIAL_MS;
  return Math.min(prevDelayMs * BACKOFF_MULTIPLIER, BACKOFF_MAX_MS);
}
