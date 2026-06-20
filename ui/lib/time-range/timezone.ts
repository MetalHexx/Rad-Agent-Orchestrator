// ui/lib/time-range/timezone.ts
// Browser-local tz is the user's local tz; native Date already bridges local⇄UTC,
// so the boundary needs no extra tz library. UTC strings drive the day-partition query.
const pad = (n: number) => String(n).padStart(2, '0');

/** A local 'YYYY-MM-DD' + 'HH:mm' as the user sees them → the UTC instant in ms. */
export function localPartsToUtcMs(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

export function utcMsToLocalDateStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function utcMsToLocalTimeStr(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The UTC calendar day — the unit the usage history API partitions on. */
export function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function localOffsetLabel(ms: number): string {
  const offMin = -new Date(ms).getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '−';
  return `local · UTC${sign}${pad(Math.floor(Math.abs(offMin) / 60))}`;
}
