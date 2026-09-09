import { readUsageForDates } from './usage-reader.js';
import { sessionUsageDates } from '../saved-sessions.js';

/** One hour: a longer gap between usage rows means the session had been left. */
export const ACTIVE_TIME_GAP_MS = 60 * 60 * 1000;

/**
 * Orders a session's usage rows by timestamp, walks the deltas, and sums those strictly
 * under `gapMs`. Derived at read time and never stored — the number keeps moving while a
 * conversation continues. Automated pipeline rows count: no row is filtered by source or
 * agent type. No rows → 0. Never throws.
 */
export function computeActiveTimeMs(opts: { root: string; sessionId: string; gapMs?: number }): number {
  const gapMs = opts.gapMs ?? ACTIVE_TIME_GAP_MS;
  let times: number[];
  try {
    const records = readUsageForDates({
      root: opts.root,
      dates: sessionUsageDates(opts.root, opts.sessionId),
      filter: (r) => r.sessionId === opts.sessionId,
    });
    times = records.map((r) => Date.parse(r.timestamp)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  } catch { return 0; }
  let active = 0;
  for (let i = 1; i < times.length; i++) {
    const delta = times[i] - times[i - 1];
    if (delta < gapMs) active += delta;
  }
  return active;
}
