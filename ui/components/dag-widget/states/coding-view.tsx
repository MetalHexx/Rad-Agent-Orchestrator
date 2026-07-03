import { SpinnerBadge } from '@/components/badges';
import { DocumentLink } from '@/components/documents';
import { CommitChips } from '@/components/dag-timeline/commit-chips';
import { Ring } from '../ring';
import { RingSlot, TitleSlot, ControlsSlot } from '../card-slots';
import type { StateView } from '../types';
import { tierTintStyle, deriveRingArc, deriveTaskNumber } from './shared';

const TIER_CSS_VAR = '--tier-execution';
const TIER_TINT_STYLE = tierTintStyle(TIER_CSS_VAR);

/**
 * The Coding work-state view (`task_executor`). Amber tier. Ring center shows
 * the current task number; its arc plots task progress within the active
 * phase. Controls surface the task's handoff doc and a commit chip for the
 * iteration's repos.
 */
export const codingView: StateView = {
  id: 'coding',
  render(ctx) {
    const taskNumber = deriveTaskNumber(ctx.iteration);
    const arc = deriveRingArc(ctx.taskProgress);
    const singleRepo = Object.keys(ctx.compareUrlByRepo).length <= 1;

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${TIER_CSS_VAR})`} mode="determinate">
            <span className="text-lg font-semibold text-foreground">{taskNumber ?? '—'}</span>
          </Ring>
        </RingSlot>
        <TitleSlot>
          <SpinnerBadge label="Coding" cssVar={TIER_CSS_VAR} isSpinning />
          <span className="truncate text-sm text-muted-foreground">
            {ctx.phaseName ?? 'Phase'}
            {taskNumber !== null && ` · Task ${taskNumber}`}
          </span>
        </TitleSlot>
        <ControlsSlot>
          <span className="inline-flex items-center gap-2" style={TIER_TINT_STYLE}>
            <DocumentLink path={ctx.iteration?.doc_path ?? null} label="Task Handoff" onDocClick={ctx.onDocClick} />
          </span>
          <CommitChips repos={ctx.repos} compareUrlByRepo={ctx.compareUrlByRepo} singleRepo={singleRepo} />
        </ControlsSlot>
      </>
    );
  },
};
