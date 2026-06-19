// ui/lib/time-range/url.ts
import { PRESET_TIERS, type RelativePreset, type TimeRange } from './range';

const isPreset = (s: string): s is RelativePreset => PRESET_TIERS.some(t => t.id === s);
const isFiniteMs = (n: number) => Number.isFinite(n) && n > 0;

export function encodeRange(r: TimeRange): string {
  switch (r.kind) {
    case 'relative': return `rel:${r.preset}`;
    case 'since':    return `since:${r.startMs}`;
    case 'absolute': return `abs:${r.startMs}-${r.endMs}`;
  }
}

export function decodeRange(raw: string | null): TimeRange | null {
  if (!raw) return null;
  if (raw.startsWith('rel:')) {
    const p = raw.slice(4);
    return isPreset(p) ? { kind: 'relative', preset: p } : null;
  }
  if (raw.startsWith('since:')) {
    const ms = Number(raw.slice(6));
    return isFiniteMs(ms) ? { kind: 'since', startMs: ms } : null;
  }
  if (raw.startsWith('abs:')) {
    const [a, b] = raw.slice(4).split('-');
    const startMs = Number(a), endMs = Number(b);
    return isFiniteMs(startMs) && isFiniteMs(endMs) && endMs > startMs
      ? { kind: 'absolute', startMs, endMs } : null;
  }
  return null;
}
