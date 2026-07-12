import { CommitChips } from '@/components/dag-timeline/commit-chips';
import { Ring } from '../ring';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { CardControlsRow, DocButton } from '../card-controls';
import type { StateView } from '../types';
import { deriveRingArc, deriveTaskNumber } from './shared';
import { deriveCardHeading } from './heading';

const TIER_CSS_VAR = '--tier-review';

/**
 * The Reviewing work-state view (`code_review`). Purple tier. Ring center
 * shows the current task number under a "TASK REVIEW" sublabel; its arc
 * plots task progress within the active phase. Heading is
 * `Reviewing: <task title>` (via `deriveCardHeading`'s state-name prefix);
 * meta is `Phase N · Task M`. Controls surface the task handoff, the task's
 * own code-review doc, and a commit chip for the iteration's repos.
 */
export const reviewingView: StateView = {
  id: 'reviewing',
  render(ctx) {
    const taskNumber = deriveTaskNumber(ctx.iteration);
    const arc = deriveRingArc(ctx.wholeGraphProgress);
    const singleRepo = Object.keys(ctx.compareUrlByRepo).length <= 1;
    const codeReviewNode = ctx.iteration?.nodes['code_review'];
    const codeReviewDocPath = codeReviewNode && 'doc_path' in codeReviewNode ? codeReviewNode.doc_path : null;
    const { heading, meta } = deriveCardHeading(ctx);

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${TIER_CSS_VAR})`} mode="determinate" sublabel="TASK REVIEW">
            <span className="text-lg font-semibold text-foreground">{taskNumber ?? '—'}</span>
          </Ring>
        </RingSlot>
        <HeadingSlot heading={heading} hasMeta={meta !== null} />
        <MetaSlot meta={meta} />
        <ControlsSlot>
          <CardControlsRow>
            <DocButton
              path={ctx.iteration?.doc_path ?? null}
              label="Task Handoff"
              onDocClick={ctx.onDocClick}
              iconCssVar={TIER_CSS_VAR}
            />
            <DocButton
              path={codeReviewDocPath}
              label="Code Review"
              onDocClick={ctx.onDocClick}
              iconCssVar={TIER_CSS_VAR}
            />
            <CommitChips repos={ctx.repos} compareUrlByRepo={ctx.compareUrlByRepo} singleRepo={singleRepo} variant="button" iconCssVar={TIER_CSS_VAR} />
          </CardControlsRow>
        </ControlsSlot>
      </>
    );
  },
};
