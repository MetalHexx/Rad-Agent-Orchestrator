// Ping-pong double buffer for the modal stage cross-fade (FR-16, DD-6, DD-7).
//
// The stage has two *stable* physical slots. A document, once loaded into a
// slot, stays mounted in that slot until it is promoted out — promotion never
// remounts a slot. This is the key property the previous front/back-by-render
// -order machine lacked: it swapped the two layers' file names on every ready
// signal, which remounted the top iframe, fired its onLoad, and swapped again
// in an infinite reload loop (the "strobe"/white-flash bug).
//
// Navigation lifecycle for a switch from the foreground doc to `next`:
//   beginNavigate  → load `next` into the *background* slot; foreground stays
//                    fully visible (no blank/white gap).
//   markIncomingReady → the background slot reported ready; start the cross-fade
//                    (incoming fades in on top of the still-visible foreground).
//   settleStage    → fade done; promote the incoming slot to foreground and free
//                    the outgoing slot. The promoted slot is NOT remounted.

export type SlotIndex = 0 | 1;
export interface Layer {
  fileName: string;
  /** Cache-bust generation for THIS slot's document. Per-layer, so reloading the
   *  background slot cannot change the foreground slot's src. */
  reloadKey?: number;
}

export interface StageState {
  /** Two stable physical slots; null means the slot holds no document. */
  slots: [Layer | null, Layer | null];
  /** Which slot is the foreground (fully-visible) document. */
  front: SlotIndex;
  /** The background slot currently loading an incoming document, or null when
   *  idle. While non-null its slot owns the per-layer ready signal. */
  incoming: SlotIndex | null;
  /** The incoming slot reported ready and is cross-fading in. */
  crossfading: boolean;
  /** What the in-flight incoming slot is doing. A live reload of the same doc
   *  must not read as a navigation, so it swaps on a shorter timer. */
  mode: 'navigate' | 'live';
}

function other(slot: SlotIndex): SlotIndex {
  return (slot === 0 ? 1 : 0) as SlotIndex;
}

export function initStage(fileName: string): StageState {
  return { slots: [{ fileName }, null], front: 0, incoming: null, crossfading: false, mode: 'navigate' };
}

/** File name of the foreground document, or null on an empty stage. */
export function frontFileName(s: StageState): string | null {
  return s.slots[s.front]?.fileName ?? null;
}

export function isNavigation(s: StageState, nextFileName: string): boolean {
  return frontFileName(s) !== nextFileName;
}

/** Load the incoming file into the background slot; the foreground stays visible
 *  so there is never a blank/white gap (FR-16, DD-8). A no-op for the same file. */
export function beginNavigate(s: StageState, nextFileName: string): StageState {
  if (!isNavigation(s, nextFileName)) return s;
  const bg = other(s.front);
  const slots: [Layer | null, Layer | null] = [s.slots[0], s.slots[1]];
  slots[bg] = { fileName: nextFileName };
  return { slots, front: s.front, incoming: bg, crossfading: false, mode: 'navigate' };
}

/** Reload the SAME document into the background slot at a new cache-bust
 *  generation, without disturbing the foreground slot's src (FR-1, DD-11).
 *  A no-op when the file isn't the one currently on the stage's foreground,
 *  or when a navigation is already in flight — a live edit must never clobber
 *  a doc switch the user just asked for. */
export function beginLiveReload(s: StageState, fileName: string, reloadKey: number): StageState {
  if (frontFileName(s) !== fileName) return s;
  if (s.incoming !== null && s.mode === 'navigate') return s;
  const bg = other(s.front);
  const slots: [Layer | null, Layer | null] = [s.slots[0], s.slots[1]];
  slots[bg] = { fileName, reloadKey };
  return { slots, front: s.front, incoming: bg, crossfading: false, mode: 'live' };
}

/** Incoming background slot reported ready → begin the cross-fade. The foreground
 *  stays put underneath; the incoming fades in on top. Idempotent, so a repeated
 *  ready signal cannot re-trigger a promotion (no swap loop). */
export function markIncomingReady(s: StageState): StageState {
  if (s.incoming === null || s.crossfading) return s;
  return { ...s, crossfading: true };
}

/** Cross-fade finished → promote the incoming slot to foreground and free the
 *  outgoing slot. The promoted slot keeps its mounted renderer (no remount). */
export function settleStage(s: StageState): StageState {
  if (s.incoming === null) return s;
  const promoted = s.incoming;
  const slots: [Layer | null, Layer | null] = [s.slots[0], s.slots[1]];
  slots[other(promoted)] = null; // free the outgoing buffer
  return { slots, front: promoted, incoming: null, crossfading: false, mode: s.mode };
}
