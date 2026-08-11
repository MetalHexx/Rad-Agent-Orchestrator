/** When the placeholder appeared, or null while it is not shown. */
export interface HoldState {
  shownAt: number | null;
}

export interface HoldResult {
  held: boolean;
  state: HoldState;
  /** Milliseconds until the caller should re-evaluate, or null when nothing is pending. */
  wakeInMs: number | null;
}

/**
 * Minimum-visible-duration floor for a placeholder, expressed as a pure step
 * function so the clock and the scheduling stay with the caller.
 *
 * Once `active` puts the placeholder on screen it is held until `floorMs` has
 * elapsed since it appeared, which suppresses a sub-`floorMs` flash. While
 * `active` stays true the placeholder is simply held with nothing pending, so a
 * condition that outlives the floor is never delayed past its own resolution.
 */
export function nextHoldState(
  prev: HoldState,
  active: boolean,
  now: number,
  floorMs: number,
): HoldResult {
  if (active) {
    return { held: true, state: { shownAt: prev.shownAt ?? now }, wakeInMs: null };
  }
  if (prev.shownAt === null) {
    return { held: false, state: prev, wakeInMs: null };
  }
  const remaining = floorMs - (now - prev.shownAt);
  if (remaining > 0) {
    return { held: true, state: prev, wakeInMs: remaining };
  }
  return { held: false, state: { shownAt: null }, wakeInMs: null };
}
