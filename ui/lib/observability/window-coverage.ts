import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import type { SessionAgg } from '@/lib/observability/sessions';
import { deriveSessions } from '@/lib/observability/sessions';

/** Fraction of a session's span covered by [rangeStart, rangeEnd] — the partial-window note (FR-10). */
export function windowCoverage(session: SessionAgg, rangeStart: number, rangeEnd: number): number {
  const span = session.lastMs - session.startedMs;
  if (span <= 0) return 1;
  const lo = Math.max(rangeStart, session.startedMs);
  const hi = Math.min(rangeEnd, session.lastMs);
  return Math.max(0, Math.min(1, (hi - lo) / span));
}

/**
 * Coverage for one session computed from UNCLIPPED rows, so start-truncation (the session
 * began before the analyzed window) is detectable rather than masked by window-clipping (FR-10).
 */
export function sessionWindowCoverage(
  allRows: ObservabilityUsageRow[],
  sessionId: string,
  rangeStart: number,
  rangeEnd: number,
): number {
  const session = deriveSessions(allRows.filter((r) => r.sessionId === sessionId)).find((s) => s.sessionId === sessionId);
  return session ? windowCoverage(session, rangeStart, rangeEnd) : 1;
}
