import { presetMs, snapUpToPresetMs, type TimeRange } from '@/lib/time-range/range';

/** The window length fed to bucketsForWindow — stable as a live `since` edge advances. */
export function windowMsForBuckets(r: TimeRange, nowMs: number): number {
  switch (r.kind) {
    case 'relative': return presetMs(r.preset);
    case 'since':    return snapUpToPresetMs(nowMs - r.startMs);
    case 'absolute': return r.endMs - r.startMs;
  }
}
