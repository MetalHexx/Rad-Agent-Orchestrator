import { cn } from '@/lib/utils';
import type { CardSlotProps } from './types';

/**
 * Fixed ring diameter (px). The ring primitive and the ring slot share this
 * value so the ring occupies identical space in every state — the alignment
 * guarantee the card frame promises.
 */
export const RING_DIAMETER = 72;

/**
 * The card's three slot wrappers own their geometry so state views never do.
 * Each claims a named CSS grid area (`ring` / `title` / `controls`) laid out
 * by the shell's grid template; views drop content inside without positioning
 * it. Kept in this leaf module (no resolver / shell imports) so the shell,
 * resolver, and views can all depend on it without an import cycle.
 */
export function RingSlot({ children, className }: CardSlotProps) {
  return (
    <div
      style={{ gridArea: 'ring', width: RING_DIAMETER, height: RING_DIAMETER }}
      className={cn('relative flex shrink-0 items-center justify-center', className)}
    >
      {children}
    </div>
  );
}

export function TitleSlot({ children, className }: CardSlotProps) {
  return (
    <div style={{ gridArea: 'title' }} className={cn('flex min-w-0 flex-col justify-center gap-1', className)}>
      {children}
    </div>
  );
}

/**
 * The controls row reserves a minimum height even when empty so the title and
 * ring keep identical coordinates whether or not a state surfaces controls.
 */
export function ControlsSlot({ children, className }: CardSlotProps) {
  return (
    <div style={{ gridArea: 'controls' }} className={cn('flex min-h-8 items-center gap-2', className)}>
      {children}
    </div>
  );
}
