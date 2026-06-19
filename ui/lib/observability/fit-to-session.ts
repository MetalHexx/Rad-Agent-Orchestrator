// ui/lib/observability/fit-to-session.ts
import type { TimeRange } from '@/lib/time-range/range';

/** A selected session pins the range to since(start), clamped to the retention floor. */
export function fitToSession(startedMs: number, floorMs: number): TimeRange {
  return { kind: 'since', startMs: Math.max(startedMs, floorMs) };
}
