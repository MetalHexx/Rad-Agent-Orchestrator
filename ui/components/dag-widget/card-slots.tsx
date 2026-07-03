import { cn } from '@/lib/utils';
import type { CardSlotProps, HeadingSlotProps, MetaSlotProps } from './types';

/**
 * Fixed ring diameter (px). The ring primitive and the ring slot share this
 * value so the ring occupies identical space in every state — the alignment
 * guarantee the card frame promises.
 */
export const RING_DIAMETER = 72;

/**
 * The card's slot wrappers own their geometry so state views never do. Each
 * claims a named CSS grid area (`ring` / `heading` / `meta` / `controls`)
 * laid out by the shell's grid template (`dag-state-card.tsx`); views drop
 * content inside without positioning it. Kept in this leaf module (no
 * resolver / shell imports) so the shell, resolver, and views can all depend
 * on it without an import cycle.
 */
export function RingSlot({ children, className }: CardSlotProps) {
  return (
    <div
      style={{ gridArea: 'ring', width: RING_DIAMETER, height: RING_DIAMETER, alignSelf: 'start' }}
      className={cn('relative flex shrink-0 items-center justify-center', className)}
    >
      {children}
    </div>
  );
}

/**
 * Single-line heading: `truncate`s and carries the full text as a `title`
 * attribute so a long title never wraps or widens the card. Anchored to the
 * end (bottom) of its flexible grid row — paired with `MetaSlot` anchored to
 * the start of the row beneath it, the two sit flush against each other and
 * float as one block, centered in the space the shell's grid reserves
 * between the ring and the controls row (see `dag-state-card.tsx`).
 */
export function HeadingSlot({ heading, className }: HeadingSlotProps) {
  return (
    <div style={{ gridArea: 'heading', alignSelf: 'end' }} className={cn('min-w-0', className)}>
      <span className="block truncate text-base font-medium text-foreground" title={heading}>
        {heading}
      </span>
    </div>
  );
}

/**
 * Meta line under the heading. Renders nothing for `meta: null` — a
 * heading-only state leaves its row empty rather than reserving a stray gap,
 * so the heading alone still centers correctly against `HeadingSlot`'s
 * end-anchor. See `HeadingSlot` for the centering mechanics.
 */
export function MetaSlot({ meta, className }: MetaSlotProps) {
  if (meta === null) return null;
  return (
    <div style={{ gridArea: 'meta', alignSelf: 'start' }} className={cn('min-w-0', className)}>
      <span className="block truncate text-xs text-muted-foreground">{meta}</span>
    </div>
  );
}

/**
 * Backward-compat shim for the retired combined title+meta slot. Existing
 * per-state views (rewritten in Phase 2 to compose `HeadingSlot` /
 * `MetaSlot` directly) keep compiling unchanged by rendering into the same
 * `heading` grid row `HeadingSlot` uses, so they inherit the pinned-anchor
 * centering for free even though they don't split their content into
 * heading vs. meta yet.
 */
export function TitleSlot({ children, className }: CardSlotProps) {
  return (
    <div
      style={{ gridArea: 'heading', alignSelf: 'end' }}
      className={cn('flex min-w-0 flex-col justify-center gap-1', className)}
    >
      {children}
    </div>
  );
}

/**
 * The controls row reserves a minimum height even when empty so it and the
 * ring keep identical coordinates whether or not a state surfaces controls.
 */
export function ControlsSlot({ children, className }: CardSlotProps) {
  return (
    <div style={{ gridArea: 'controls' }} className={cn('flex min-h-8 items-center gap-2', className)}>
      {children}
    </div>
  );
}
