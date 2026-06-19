const RETENTION_DAYS = 14;
export function previousUtcDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
export function retentionFloorDay(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (RETENTION_DAYS - 1));
  return d.toISOString().slice(0, 10);
}
export function canLoadEarlier(earliestShown: string, today: string): boolean {
  return earliestShown > retentionFloorDay(today);
}
