import type { SessionAgg } from '@/lib/observability/sessions';

/** Fraction of a session's span covered by [rangeStart, rangeEnd] — the partial-window note (FR-10). */
export function windowCoverage(session: SessionAgg, rangeStart: number, rangeEnd: number): number {
  const span = session.lastMs - session.startedMs;
  if (span <= 0) return 1;
  const lo = Math.max(rangeStart, session.startedMs);
  const hi = Math.min(rangeEnd, session.lastMs);
  return Math.max(0, Math.min(1, (hi - lo) / span));
}
