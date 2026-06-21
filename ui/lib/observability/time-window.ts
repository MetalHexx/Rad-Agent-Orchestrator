import { type TimeRange, resolveWindow } from '@/lib/time-range/range';
import { windowMsForBuckets } from '@/lib/observability/bucket-count';
import { bucketsForWindow } from '@/lib/observability/time-range';

/**
 * Immutable value object for "what slice of time we're showing and how it's gridded".
 * Raw bounds (rangeStart/rangeEnd) are the chart's X-axis domain and tick source; the
 * snapped nominal window + bucket count are the bucketing grid, kept invariant as a live
 * window grows each tick. Wraps existing helpers — it does not re-derive the math (AD-2, FR-11).
 */
export class TimeWindow {
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly nominalWindowMs: number;
  readonly buckets: number;

  constructor(range: TimeRange, nowMs: number, floorMs: number) {
    const { startMs, endMs } = resolveWindow(range, nowMs, floorMs);
    this.rangeStart = startMs;
    this.rangeEnd = endMs;
    this.nominalWindowMs = windowMsForBuckets(range, nowMs);
    this.buckets = bucketsForWindow(this.nominalWindowMs);
  }

  /** Grid-anchored bucketing opts for timeBucketedRateByModel — endMs is the RAW range end
   *  so the axis domain and the data share one end (AD-2, FR-11). */
  chartBucketOpts(): { endMs: number; windowMs: number; buckets: number; anchor: 'grid' } {
    return { endMs: this.rangeEnd, windowMs: this.nominalWindowMs, buckets: this.buckets, anchor: 'grid' };
  }
}
