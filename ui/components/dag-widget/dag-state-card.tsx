'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProjectStateV5, ProjectStateV6 } from '@/types/state';
import { resolveStateView } from './resolver';
import { RING_DIAMETER } from './card-slots';

export interface DagStateCardProps {
  state: ProjectStateV5 | ProjectStateV6;
  /** Node path to render; defaults to `graph.current_node_path` (the R9 seam
   *  for later row-selection — no affordance or interaction today). */
  focus?: string;
  onDocClick: (path: string) => void;
  compareUrlByRepo: Record<string, string | null>;
  projectName: string;
}

// Five-row grid: the ring column spans the full card height on the left at a
// fixed width, and the ring `alignSelf: center`s within it (see `RingSlot`).
// The heading/meta/controls trio occupies the three middle `auto` rows,
// flanked by equal `minmax(0, 1fr)` spacer rows top and bottom — so that
// content block is vertically centered as a unit. With both the ring and the
// content block centered, their centers coincide at the card's vertical
// middle regardless of how many lines the content occupies. The ring's fixed
// diameter sets the card's minimum height, keeping every state's footprint
// identical (R8) even when the controls row is empty.
const SLOT_GRID_TEMPLATE =
  `"ring ." minmax(0, 1fr)` +
  ` "ring heading" auto` +
  ` "ring meta" auto` +
  ` "ring controls" auto` +
  ` "ring ." minmax(0, 1fr)` +
  ` / ${RING_DIAMETER}px minmax(0, 1fr)`;

/**
 * Tracks the OS `prefers-reduced-motion` preference so the crossfade can be
 * suppressed. Starts `false` for a stable SSR / first-paint value, then syncs
 * on mount and on change.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** A frozen snapshot of one state's rendered content, kept mounted just long
 *  enough to fade out beneath the incoming state during a crossfade. */
interface FadingLayer {
  id: string;
  content: React.ReactNode;
}

/**
 * The card shell: a static shadcn `Card` frame that owns the four fixed
 * regions (ring / heading / meta / controls) and knows nothing about
 * pipelines. It resolves the active view from
 * `focus ?? graph.current_node_path`, then renders that view's content into
 * the slots. On a state change it runs a true crossfade: the outgoing state's
 * content stays mounted in the same grid cell and fades OUT (`animate-out
 * fade-out-0`) while the incoming content fades IN (`animate-in fade-in-0`)
 * on top, then the outgoing layer unmounts on `onAnimationEnd`. Both layers
 * are stacked in a single-cell overlap grid so the frame never grows or jumps
 * during the swap. Under `prefers-reduced-motion` the outgoing layer is
 * skipped entirely and the swap is instant.
 */
export function DagStateCard({ state, focus, onDocClick, compareUrlByRepo, projectName }: DagStateCardProps) {
  const reduced = usePrefersReducedMotion();
  const { view, ctx } = resolveStateView(state, focus, { onDocClick, compareUrlByRepo, projectName });
  const stateId = ctx.stateId;
  const content = view.render(ctx);

  // The previous render committed to the DOM, and the outgoing layer currently
  // fading out (if any). `committed` is updated every render so a same-state
  // re-render (a poll that only changes progress) refreshes the baseline
  // without triggering a crossfade.
  const [outgoing, setOutgoing] = React.useState<FadingLayer | null>(null);
  const committed = React.useRef<FadingLayer | null>(null);

  // Detect a state change and snapshot the outgoing content. Declared before
  // the commit effect below so it still reads the *previous* committed render.
  React.useEffect(() => {
    const prev = committed.current;
    if (prev && prev.id !== stateId && !reduced) {
      setOutgoing(prev);
    }
  });
  // Commit the latest render as the baseline for the next comparison.
  React.useEffect(() => {
    committed.current = { id: stateId, content };
  });

  return (
    <Card>
      <div className="px-4">
        <div className="grid">
          {outgoing && (
            <div
              key={`out-${outgoing.id}`}
              aria-hidden="true"
              className="grid gap-x-4 pointer-events-none animate-out fade-out-0 fill-mode-forwards duration-300"
              style={{ gridTemplate: SLOT_GRID_TEMPLATE, gridArea: '1 / 1' }}
              onAnimationEnd={() => setOutgoing((cur) => (cur === outgoing ? null : cur))}
            >
              {outgoing.content}
            </div>
          )}
          <div
            key={stateId}
            className={cn('grid gap-x-4', !reduced && 'animate-in fade-in-0 duration-300')}
            style={{ gridTemplate: SLOT_GRID_TEMPLATE, gridArea: '1 / 1' }}
          >
            {content}
          </div>
        </div>
      </div>
    </Card>
  );
}
