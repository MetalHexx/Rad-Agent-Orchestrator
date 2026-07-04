import { cn } from '@/lib/utils';
import type { CardSlotProps, HeadingSlotProps, MetaSlotProps } from './types';

/**
 * Fixed ring diameter (px). The ring primitive and the ring slot share this
 * value so the ring occupies identical space in every state — the alignment
 * guarantee the card frame promises.
 */
export const RING_DIAMETER = 96;

/**
 * The card's slot wrappers own their geometry so state views never do. Each
 * claims a named CSS grid area (`ring` / `heading` / `meta` / `controls`)
 * laid out by the shell's grid template (`dag-state-card.tsx`); views drop
 * content inside without positioning it. Kept in this leaf module (no
 * resolver / shell imports) so the shell, resolver, and views can all depend
 * on it without an import cycle.
 *
 * `ring`'s named area spans the full height of the card (every row, including
 * the flexible spacer rows above and below the heading/meta/controls stack),
 * and the ring `alignSelf: center`s within that span so it sits vertically
 * centered against the whole card on the left. The shell's grid template
 * (`dag-state-card.tsx`) flanks the heading/meta/controls trio with equal
 * `1fr` spacer rows, so that content block is centered too — the ring's
 * center and the content block's center coincide at the card's vertical
 * middle. The ring's fixed diameter sets the card's minimum height, so an
 * empty-controls state can never render shorter than the ring (R8's
 * identical-footprint guarantee).
 */
export function RingSlot({ children, className }: CardSlotProps) {
  return (
    <div
      style={{ gridArea: 'ring', width: RING_DIAMETER, height: RING_DIAMETER, alignSelf: 'center' }}
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
 * With `hasMeta`, it anchors to the end (bottom) of its own row — paired with
 * `MetaSlot` anchored to the start of the row beneath it, the two sit flush
 * against each other across the shared row boundary, reading as a tight
 * title/subtitle pair.
 *
 * Without a meta line, anchoring alone in the heading row would leave the
 * heading floating above the card's center (the empty meta and controls rows
 * still claim their share of the height below it). Instead it spans all three
 * content rows — heading, meta, and controls — and centers within them, so a
 * heading-only state (Planning, fallback: no meta, empty controls) sits
 * vertically centered on the ring beside it rather than riding high. Such
 * states never render controls, so nothing is overlapped.
 */
export function HeadingSlot({ heading, hasMeta = false, className }: HeadingSlotProps) {
  const style = hasMeta
    ? { gridArea: 'heading', alignSelf: 'end' as const }
    : { gridArea: 'heading-start / heading-start / controls-end / heading-end', alignSelf: 'center' as const };
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
export function MetaSlot({ meta, title, className }: MetaSlotProps) {
  if (meta === null) return null;
  return (
    <div style={{ gridArea: 'meta', alignSelf: 'start' }} className={cn('min-w-0', className)}>
      <span className="block truncate text-xs text-muted-foreground" title={title}>{meta}</span>
    </div>
  );
}

/**
 * The controls row sits below the ring-height block, sized by its own
 * content. It reserves a minimum height even when empty so its own
 * coordinates stay identical whether or not a state surfaces controls;
 * unlike the ring, it plays no part in sizing the heading/meta rows above it
 * (see `RingSlot`).
 *
 * `min-w-0` — like the other content slots — lets this flex row actually
 * shrink inside its `minmax(0, 1fr)` grid track. Without it a wide controls
 * cluster (a multi-repo commit-chip row plus doc buttons) refuses to shrink
 * and overruns the card edge instead of wrapping (see `CommitChips`, whose
 * own row also wraps).
 *
 * `mt-2` breaks the action row away from the heading/meta pair above it: the
 * title and subtitle sit flush as one unit, then a uniform 8px gap (matching
 * the row's own `gap-2`) sets the buttons apart so they never crowd the meta
 * line. On a state with no controls the empty row's margin is invisible, so
 * the footprint stays identical (R8).
 */
export function ControlsSlot({ children, className }: CardSlotProps) {
  return (
    <div style={{ gridArea: 'controls' }} className={cn('mt-2 flex min-h-8 min-w-0 items-center gap-2', className)}>
      {children}
    </div>
  );
}
