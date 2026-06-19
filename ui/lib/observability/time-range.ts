import { retentionFloorDay } from './day-window';

export type QuickRangeId = '15m' | '1h' | '6h' | '24h' | '7d' | '14d';
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const QUICK_RANGES: { id: QuickRangeId; label: string; ms: number }[] = [
  { id: '15m', label: 'Last 15 minutes', ms: 15 * MIN },
  { id: '1h',  label: 'Last 1 hour',     ms: HOUR },
  { id: '6h',  label: 'Last 6 hours',    ms: 6 * HOUR },
  { id: '24h', label: 'Last 24 hours',   ms: DAY },
  { id: '7d',  label: 'Last 7 days',     ms: 7 * DAY },
  { id: '14d', label: 'Last 14 days',    ms: 14 * DAY },
];
export const DEFAULT_RANGE_ID: QuickRangeId = '24h';
export function rangeMs(id: QuickRangeId): number {
  return (QUICK_RANGES.find(r => r.id === id) ?? QUICK_RANGES[3]).ms;
}
export function rangeWindow(id: QuickRangeId, nowMs: number): { startMs: number; endMs: number } {
  const floorMs = Date.parse(`${retentionFloorDay(new Date(nowMs).toISOString().slice(0, 10))}T00:00:00Z`);
  return { startMs: Math.max(nowMs - rangeMs(id), floorMs), endMs: nowMs };
}
export function rangeUtcDates(startMs: number, endMs: number): string[] {
  const out: string[] = [];
  const d = new Date(`${new Date(startMs).toISOString().slice(0, 10)}T00:00:00Z`);
  const last = new Date(`${new Date(endMs).toISOString().slice(0, 10)}T00:00:00Z`);
  for (; d <= last; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
// Scale the chart bucket count to the window, clamped to a smooth 60..120 band (NFR-4).
export function bucketsForWindow(windowMs: number): number {
  const FIVE_MIN = 5 * 60_000;
  return Math.max(60, Math.min(120, Math.round(windowMs / FIVE_MIN)));
}
