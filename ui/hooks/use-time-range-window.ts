"use client";
import * as React from 'react';
import { type TimeRange, DEFAULT_RANGE, retentionFloorMs, isLive } from '@/lib/time-range/range';
import { TimeWindow } from '@/lib/observability/time-window';

function useNow(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface TimeRangeWindow {
  range: TimeRange;
  setRange: (r: TimeRange) => void;
  window: TimeWindow;
  now: number;          // 1s clock — freshness + activity decay only
  floorMs: number;      // retention floor for the picker min
  effectiveTick: number;
  manualTick: number;
  refreshNow: () => void;
}

/** Owns range + the two interval clocks; constructs the TimeWindow that the chart, table,
 *  freshness, and picker all read. React state lives here; the math lives in TimeWindow (AD-6). */
export function useTimeRangeWindow(initial: TimeRange = DEFAULT_RANGE): TimeRangeWindow {
  const [range, setRange] = React.useState<TimeRange>(initial);
  const now = useNow(1000);
  const tick = useNow(isLive(range) ? 5000 : 3_600_000);
  const [manualTick, setManualTick] = React.useState(0);
  const effectiveTick = Math.max(tick, manualTick);
  const floorMs = retentionFloorMs(tick);
  const window = React.useMemo(
    () => new TimeWindow(range, effectiveTick, floorMs),
    [range, effectiveTick, floorMs]
  );
  const refreshNow = React.useCallback(() => { setManualTick(Date.now()); }, []);
  return { range, setRange, window, now, floorMs, effectiveTick, manualTick, refreshNow };
}
