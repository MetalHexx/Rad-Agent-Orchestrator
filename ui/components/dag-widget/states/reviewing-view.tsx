import { SpinnerBadge } from '@/components/badges';
import { DocumentLink } from '@/components/documents';
import { CommitChips } from '@/components/dag-timeline/commit-chips';
import { Ring } from '../ring';
import { RingSlot, TitleSlot, ControlsSlot } from '../card-slots';
import type { StateView } from '../types';
import { tierTintStyle, deriveRingArc, deriveTaskNumber } from './shared';

const TIER_CSS_VAR = '--tier-review';
const TIER_TINT_STYLE = tierTintStyle(TIER_CSS_VAR);

/**
 * The Reviewing work-state view (`code_review`). Purple tier. Ring center
 * shows the current task number; its arc plots task progress within the active
 * phase. Controls surface the task handoff, the task's own code-review doc,
 * and a commit chip for the iteration's repos.
 */
export const reviewingView: StateView = {
  id: 'reviewing',
  render(ctx) {
    const taskNumber = deriveTaskNumber(ctx.iteration);
    const arc = deriveRingArc(ctx.taskProgress);
    const singleRepo = Object.keys(ctx.compareUrlByRepo).length <= 1;
    const codeReviewNode = ctx.iteration?.nodes['code_review'];
    const codeReviewDocPath = codeReviewNode && 'doc_path' in codeReviewNode ? codeReviewNode.doc_path : null;

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${TIER_CSS_VAR})`} mode="determinate">
            <span className="text-lg font-semibold text-foreground">{taskNumber ?? '—'}</span>
          </Ring>
        </RingSlot>
        <TitleSlot>
          <SpinnerBadge label="Reviewing" cssVar={TIER_CSS_VAR} isSpinning />
          <span className="truncate text-sm text-muted-foreground">
            {ctx.phaseName ?? 'Phase'}
            {taskNumber !== null && ` · Task ${taskNumber}`}
          </span>
        </TitleSlot>
        <ControlsSlot>
          <span className="inline-flex items-center gap-2" style={TIER_TINT_STYLE}>
            <DocumentLink path={ctx.iteration?.doc_path ?? null} label="Task Handoff" onDocClick={ctx.onDocClick} />
            <DocumentLink path={codeReviewDocPath} label="Code Review" onDocClick={ctx.onDocClick} />
          </span>
          <CommitChips repos={ctx.repos} compareUrlByRepo={ctx.compareUrlByRepo} singleRepo={singleRepo} />
        </ControlsSlot>
      </>
    );
  },
};
