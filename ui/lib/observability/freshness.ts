import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';

export interface Freshness { latestMs: number; msSinceActivity: number; }

/** Latest activity timestamp across rows + elapsed since `nowMs`; idle (latest 0, elapsed
 *  Infinity) when there are no rows — mirrors the view's latestMs>0 ? … : Infinity (AD-4, FR-5). */
export function freshness(rows: Iterable<ObservabilityUsageRow>, nowMs: number): Freshness {
  let latestMs = 0;
  for (const r of rows) {
    const t = Date.parse(r.timestamp);
    if (t > latestMs) latestMs = t;
  }
  return { latestMs, msSinceActivity: latestMs > 0 ? nowMs - latestMs : Infinity };
}
