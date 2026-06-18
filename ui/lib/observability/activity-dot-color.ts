export const DECAY_WINDOW_MS = 5 * 60 * 1000;

export function dotFreshness(msSinceActivity: number): number {
  if (msSinceActivity <= 0) return 1;
  if (msSinceActivity >= DECAY_WINDOW_MS) return 0;
  return 1 - msSinceActivity / DECAY_WINDOW_MS;
}

/** Token-driven resting color: lavender → grey, so it stays light/dark adaptive (DD-7, NFR-2). */
export function dotRestingColor(msSinceActivity: number): string {
  const pct = Math.round(dotFreshness(msSinceActivity) * 100);
  return `color-mix(in srgb, var(--live-accent) ${pct}%, var(--muted-foreground))`;
}

export function isActive(msSinceActivity: number): boolean {
  return msSinceActivity < DECAY_WINDOW_MS;
}
