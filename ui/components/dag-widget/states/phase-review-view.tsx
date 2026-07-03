import type { CSSProperties } from 'react';
import { DocumentLink } from '@/components/documents';
import { Ring } from '../ring';
import { RingSlot, TitleSlot, ControlsSlot } from '../card-slots';
import type { StateView } from '../types';

const TIER_CSS_VAR = '--tier-review';

/**
 * Overrides `--primary` for the wrapped subtree so `DocumentLink`'s
 * hard-coded `text-primary` icon/label resolve to this state's tier color —
 * same technique the work-state views use.
 */
const TIER_TINT_STYLE = { '--primary': `var(${TIER_CSS_VAR})` } as CSSProperties;

/**
 * Ring arc `{value, max}` from the resolver's phase progress. Falls back to
 * an empty-but-valid `{0, 1}` domain (never `{0, 0}`, which would hand the
 * ring a degenerate arc domain) when no phase progress is derivable yet.
 */
export function deriveRingArc(
  phaseProgress: { completed: number; total: number } | null,
): { value: number; max: number } {
  if (phaseProgress === null || phaseProgress.total <= 0) return { value: 0, max: 1 };
  return { value: phaseProgress.completed, max: phaseProgress.total };
}

/**
 * 1-based phase number for display. The active node under `phase_review` is
 * the phase iteration itself (the resolver walks `phase_loop.iter{N}` before
 * reaching the `phase_review` leaf), so the enclosing iteration's index is
 * the phase number — unlike the work-state views, where the enclosing
 * iteration is the task, not the phase.
 */
export function derivePhaseNumber(iteration: { index: number } | undefined): number | null {
  return iteration ? iteration.index + 1 : null;
}

/**
 * The Phase Review milestone view (`phase_review`). Purple tier, determinate
 * ring showing phase position across the run. Controls surface only the
 * phase review report — no commit chip at this milestone.
 */
export const phaseReviewView: StateView = {
  id: 'phase-review',
  render(ctx) {
    const phaseNumber = derivePhaseNumber(ctx.iteration);
    const arc = deriveRingArc(ctx.phaseProgress);
    const docPath = ctx.node && ctx.node.kind === 'step' ? ctx.node.doc_path : null;

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${TIER_CSS_VAR})`} mode="determinate">
            <span className="text-lg font-semibold text-foreground">{phaseNumber ?? '—'}</span>
          </Ring>
        </RingSlot>
        <TitleSlot>
          <span className="truncate text-base font-medium text-foreground">
            {phaseNumber !== null ? `Phase ${phaseNumber} Review` : 'Phase Review'}
          </span>
        </TitleSlot>
        <ControlsSlot>
          <span className="inline-flex items-center gap-2" style={TIER_TINT_STYLE}>
            <DocumentLink path={docPath} label="Report" onDocClick={ctx.onDocClick} />
          </span>
        </ControlsSlot>
      </>
    );
  },
};
