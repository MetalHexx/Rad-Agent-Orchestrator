// ui/components/time-range/absolute-form.ts
import type { TimeRange } from '@/lib/time-range/range';

export interface AbsoluteForm {
  startDate: string; startTime: string;
  endMode: 'now' | 'specific';
  endDate: string; endTime: string;
  floorMs: number;
  nowMs: number;
}

const hasParts = (d: string, t: string) => Boolean(d && t);

/** Parse a local YYYY-MM-DD + HH:mm as a UTC instant (the calendar emits UTC day strings). */
const partsToMs = (d: string, t: string): number => Date.parse(`${d}T${t}:00Z`);

export function formToTimeRange(f: AbsoluteForm): TimeRange | null {
  if (!hasParts(f.startDate, f.startTime)) return null;
  const startMs = partsToMs(f.startDate, f.startTime);
  if (f.endMode === 'now') return { kind: 'since', startMs };
  if (!hasParts(f.endDate, f.endTime)) return null;
  return { kind: 'absolute', startMs, endMs: partsToMs(f.endDate, f.endTime) };
}

export function validateForm(f: AbsoluteForm): { valid: boolean; hint?: string } {
  const range = formToTimeRange(f);
  if (!range) return { valid: false, hint: 'Pick a start date and time.' };
  const startMs = range.startMs;
  const endMs = range.kind === 'absolute' ? range.endMs : f.nowMs;
  if (startMs < f.floorMs) return { valid: false, hint: 'Start is before the 14-day retention window.' };
  if (endMs <= startMs) return { valid: false, hint: 'Start must be before end.' };
  if (startMs > f.nowMs || endMs > f.nowMs) return { valid: false, hint: 'Times cannot be in the future.' };
  return { valid: true };
}
