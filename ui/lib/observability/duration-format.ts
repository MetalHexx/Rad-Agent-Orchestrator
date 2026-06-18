export function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m`;
}
