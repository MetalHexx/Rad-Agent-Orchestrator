// ui/components/time-range/range-label.ts
import { format } from 'date-fns';
import { PRESET_TIERS, type TimeRange } from '@/lib/time-range/range';

const fmt = (ms: number) => format(new Date(ms), 'MMM d, h:mm a');   // was 'MMM d, HH:mm'

export function rangePillLabel(r: TimeRange): string {
  switch (r.kind) {
    case 'relative': return PRESET_TIERS.find(t => t.id === r.preset)?.label ?? 'Last 24 hours';
    case 'since':    return `${fmt(r.startMs)} → Now`;
    case 'absolute': return `${fmt(r.startMs)} → ${fmt(r.endMs)}`;
  }
}
