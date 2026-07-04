import { Ring } from '../ring';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { CardControlsRow, DocButton } from '../card-controls';
import type { StateView } from '../types';
import { deriveRingArc } from './shared';
import { deriveCardHeading } from './heading';

const TIER_CSS_VAR = '--tier-review';

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
 * ring showing phase position across the run with a "PHASE REVIEW" sublabel.
 * Heading/meta come from `deriveCardHeading`: heading is
 * `Phase Review: <phase title>`, meta is "Phase N". Controls surface only the
 * phase review report — no commit chip at this milestone.
 */
export const phaseReviewView: StateView = {
  id: 'phase-review',
  render(ctx) {
    const phaseNumber = derivePhaseNumber(ctx.iteration);
    const arc = deriveRingArc(ctx.phaseProgress);
    const docPath = ctx.node && ctx.node.kind === 'step' ? ctx.node.doc_path : null;
    const { heading, meta } = deriveCardHeading(ctx);

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${TIER_CSS_VAR})`} mode="determinate" sublabel="PHASE REVIEW">
            <span className="text-lg font-semibold text-foreground">{phaseNumber ?? '—'}</span>
          </Ring>
        </RingSlot>
        <HeadingSlot heading={heading} hasMeta={meta !== null} />
        <MetaSlot meta={meta} />
        <ControlsSlot>
          <CardControlsRow>
            <DocButton path={docPath} label="Report" onDocClick={ctx.onDocClick} iconCssVar={TIER_CSS_VAR} />
          </CardControlsRow>
        </ControlsSlot>
      </>
    );
  },
};
