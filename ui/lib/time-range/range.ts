// ui/lib/time-range/range.ts
import { retentionFloorDay } from '@/lib/observability/day-window';

export type RelativePreset = '15m' | '1h' | '6h' | '24h' | '7d' | '14d';

export type TimeRange =
  | { kind: 'relative'; preset: RelativePreset }
  | { kind: 'since'; startMs: number }
  | { kind: 'absolute'; startMs: number; endMs: number };

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export const PRESET_TIERS: { id: RelativePreset; label: string; ms: number }[] = [
  { id: '15m', label: 'Last 15 minutes', ms: 15 * MIN },
  { id: '1h',  label: 'Last 1 hour',     ms: HOUR },
  { id: '6h',  label: 'Last 6 hours',    ms: 6 * HOUR },
  { id: '24h', label: 'Last 24 hours',   ms: DAY },
  { id: '7d',  label: 'Last 7 days',     ms: 7 * DAY },
  { id: '14d', label: 'Last 14 days',    ms: 14 * DAY },
];

export const DEFAULT_RANGE: TimeRange = { kind: 'relative', preset: '24h' };

export function presetMs(p: RelativePreset): number {
  return (PRESET_TIERS.find(t => t.id === p) ?? PRESET_TIERS[3]).ms;
}

export const isLive = (r: TimeRange): boolean => r.kind !== 'absolute';

/** UTC ms of the retention floor's first instant for a given 'now'. */
export function retentionFloorMs(nowMs: number): number {
  return Date.parse(`${retentionFloorDay(new Date(nowMs).toISOString().slice(0, 10))}T00:00:00Z`);
}

export function resolveWindow(r: TimeRange, nowMs: number, floorMs: number): { startMs: number; endMs: number } {
  switch (r.kind) {
    case 'relative': return { startMs: Math.max(nowMs - presetMs(r.preset), floorMs), endMs: nowMs };
    case 'since':    return { startMs: Math.max(r.startMs, floorMs), endMs: nowMs };
    case 'absolute': return { startMs: Math.max(r.startMs, floorMs), endMs: r.endMs };
  }
}

/** Snap a window length UP to the nearest preset tier (stable bucket grid for `since`). */
export function snapUpToPresetMs(windowMs: number): number {
  for (const tier of PRESET_TIERS) if (windowMs <= tier.ms) return tier.ms;
  return PRESET_TIERS[PRESET_TIERS.length - 1].ms;
}
