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

// Three-row grid: the ring spans only the heading and meta rows on the left,
// at a fixed width — never the controls row. Its fixed 72px height is what
// forces those two equally-flexible (`minmax(0, 1fr)`) rows to sum to
// exactly 72px, so the heading/meta block's own vertical center always
// lands on the ring's center, independent of the controls row's height:
// with a meta line, the heading anchors to the end of its row and the meta
// to the start of its own, meeting flush at that ring-center boundary; alone
// (see `HeadingSlot`/`TitleSlot`), the heading instead spans both rows and
// centers within their combined height, landing on the same boundary. The
// controls row is `auto`, sized by its own content and pinned directly below
// that ring-height block.
const SLOT_GRID_TEMPLATE = `"ring heading" minmax(0, 1fr) "ring meta" minmax(0, 1fr) ". controls" auto / ${RING_DIAMETER}px minmax(0, 1fr)`;

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

/**
 * The card shell: a static shadcn `Card` frame that owns the four fixed
 * regions (ring / heading / meta / controls) and knows nothing about
 * pipelines. It resolves the active view from
 * `focus ?? graph.current_node_path`, then renders that view's content into the
 * slots inside a crossfade region keyed by the resolved state id — the frame
 * stays put; only the inner content dissolves between states. Under
 * `prefers-reduced-motion` the swap is instant.
 */
export function DagStateCard({ state, focus, onDocClick, compareUrlByRepo, projectName }: DagStateCardProps) {
  const reduced = usePrefersReducedMotion();
  const { view, ctx } = resolveStateView(state, focus, { onDocClick, compareUrlByRepo, projectName });

  return (
    <Card>
      <div className="px-4">
        <div
          key={ctx.stateId}
          className={cn('grid gap-x-4', !reduced && 'animate-in fade-in-0 duration-300')}
          style={{ gridTemplate: SLOT_GRID_TEMPLATE }}
        >
          {view.render(ctx)}
        </div>
      </div>
    </Card>
  );
}
