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
