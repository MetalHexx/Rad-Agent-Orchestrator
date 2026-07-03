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

// Three-row grid: the ring spans all three rows on the left at a fixed
// width. The heading and meta rows are equally flexible (`minmax(0, 1fr)`)
// with the heading anchored to the bottom of its row and the meta anchored
// to the top of its own — flush against each other, the pair floats
// centered in the space the two flexible rows share, whether or not a meta
// line is present. The controls row is `auto`, pinned to the bottom. Ring
// and controls therefore hold identical coordinates in every state; only
// the heading/meta block moves to stay centered between them.
const SLOT_GRID_TEMPLATE = `"ring heading" minmax(0, 1fr) "ring meta" minmax(0, 1fr) "ring controls" auto / ${RING_DIAMETER}px minmax(0, 1fr)`;

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
