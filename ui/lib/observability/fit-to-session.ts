// ui/lib/observability/fit-to-session.ts
import type { TimeRange } from '@/lib/time-range/range';
import { snapUpToPresetMs } from '@/lib/time-range/range';
import { bucketsForWindow } from '@/lib/observability/time-range';

const LEAD_IN_BUCKETS = 2;

/** Pin to since(start), backed off by a small grid-aligned lead-in so the chart's first rate
 *  bucket renders in full (not clipped at the domain's left edge). Clamped to the retention floor.
 *
 *  The lead-in widens the `since` window, which can push it across a preset-tier boundary onto a
 *  COARSER chart grid. We therefore size the lead-in from the tier the chart will ACTUALLY use
 *  (re-snapped after the provisional shift), guaranteeing the lead-in spans >= LEAD_IN_BUCKETS full
 *  chart buckets even for sessions sized just under a tier boundary. One re-snap suffices: the
 *  lead-in is a tiny fraction of any tier, so it can cross at most one boundary. */
export function fitToSession(startedMs: number, floorMs: number, nowMs: number): TimeRange {
  const bucketMsFor = (windowMs: number) => windowMs / bucketsForWindow(windowMs);
  const provisionalStart = startedMs - LEAD_IN_BUCKETS * bucketMsFor(snapUpToPresetMs(nowMs - startedMs));
  const chartNominalMs = snapUpToPresetMs(nowMs - provisionalStart);   // tier the chart actually grids on
  const startMs = Math.max(startedMs - LEAD_IN_BUCKETS * bucketMsFor(chartNominalMs), floorMs);
  return { kind: 'since', startMs };
}
