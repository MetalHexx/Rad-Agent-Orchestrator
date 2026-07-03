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

// Two-row grid: the ring spans both rows on the left at a fixed width; the
// title sits top-right, controls bottom-right. Identical in every state, so the
// three slots keep identical coordinates as the resolved content crossfades.
const SLOT_GRID_TEMPLATE = `"ring title" auto "ring controls" auto / ${RING_DIAMETER}px minmax(0, 1fr)`;

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
 * The card shell: a static shadcn `Card` frame that owns the three fixed slots
 * and knows nothing about pipelines. It resolves the active view from
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
          className={cn('grid items-center gap-x-4', !reduced && 'animate-in fade-in-0 duration-300')}
          style={{ gridTemplate: SLOT_GRID_TEMPLATE }}
        >
          {view.render(ctx)}
        </div>
      </div>
    </Card>
  );
}
