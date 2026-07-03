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
 *
 * `ring`'s named area spans only the heading and meta rows, never the
 * controls row: its fixed 72px height is what forces those two flexible
 * rows to sum to exactly 72px (a grid item with a fixed block size inside a
 * `minmax(0, 1fr)` track drives that track's flex-fraction resolution), so
 * the heading/meta block's own center always lands on the ring's center
 * regardless of the controls row's height. Spanning the controls row too
 * would tie that 72px sum to the controls row's height as well, pulling the
 * heading off-center whenever a meta line isn't present to fill the second
 * row (see `HeadingSlot`).
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
 * attribute so a long title never wraps or widens the card.
 *
 * With `hasMeta`, it anchors to the end (bottom) of its own flexible row —
 * paired with `MetaSlot` anchored to the start of the row beneath it, the
 * two sit flush against each other across the shared row boundary, which
 * sits exactly at the ring's center (see `RingSlot`).
 *
 * Without a meta line, anchoring alone in the heading row leaves it
 * off-center (the meta row still claims its share of the ring-driven 72px
 * split even though nothing renders there). Instead it spans both the
 * heading and meta rows and centers within their combined height, landing
 * on the same ring-center boundary a heading+meta pair would meet at.
 */
export function HeadingSlot({ heading, hasMeta = false, className }: HeadingSlotProps) {
  const style = hasMeta
    ? { gridArea: 'heading', alignSelf: 'end' as const }
    : { gridArea: 'heading-start / heading-start / meta-end / heading-end', alignSelf: 'center' as const };
  return (
    <div style={style} className={cn('min-w-0', className)}>
      <span className="block truncate text-base font-medium text-foreground" title={heading}>
        {heading}
      </span>
    </div>
  );
}

/**
 * Meta line under the heading. Renders nothing for `meta: null` — callers
 * pass that same nullness to `HeadingSlot`'s `hasMeta` so the heading
 * switches to its own centered, both-rows-spanning layout instead of
 * anchoring against an empty row. See `HeadingSlot` for the centering
 * mechanics.
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
 * `MetaSlot` directly) keep compiling unchanged. It never renders alongside
 * a `MetaSlot`, so it always uses the heading's solo layout — spanning both
 * the heading and meta rows and centering within their combined height —
 * the same centering `HeadingSlot({ hasMeta: false })` gets.
 */
export function TitleSlot({ children, className }: CardSlotProps) {
  return (
    <div
      style={{ gridArea: 'heading-start / heading-start / meta-end / heading-end', alignSelf: 'center' }}
      className={cn('flex min-w-0 flex-col justify-center gap-1', className)}
    >
      {children}
    </div>
  );
}

/**
 * The controls row sits below the ring-height block, sized by its own
 * content. It reserves a minimum height even when empty so its own
 * coordinates stay identical whether or not a state surfaces controls;
 * unlike the ring, it plays no part in sizing the heading/meta rows above it
 * (see `RingSlot`).
 */
export function ControlsSlot({ children, className }: CardSlotProps) {
  return (
    <div style={{ gridArea: 'controls' }} className={cn('flex min-h-8 items-center gap-2', className)}>
      {children}
    </div>
  );
}
