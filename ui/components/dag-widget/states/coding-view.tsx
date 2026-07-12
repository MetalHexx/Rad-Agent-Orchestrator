import { CommitChips } from '@/components/dag-timeline/commit-chips';
import { Ring } from '../ring';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { CardControlsRow, DocButton } from '../card-controls';
import type { StateView } from '../types';
import { deriveRingArc, deriveTaskNumber, formatComplexity } from './shared';
import { deriveCardHeading } from './heading';

const TIER_CSS_VAR = '--tier-execution';

/**
 * The Coding work-state view (`task_executor`). Amber tier. Ring center shows
 * the current task number under a "TASK" sublabel; its arc plots task
 * progress within the active phase. Heading is `Coding: <task title>` (via
 * `deriveCardHeading`'s state-name prefix); meta is `Phase N · Task M`.
 * Controls surface the task's handoff doc and a commit chip for the
 * iteration's repos.
 */
export const codingView: StateView = {
  id: 'coding',
  render(ctx) {
    const taskNumber = deriveTaskNumber(ctx.iteration);
    const arc = deriveRingArc(ctx.wholeGraphProgress);
    const singleRepo = Object.keys(ctx.compareUrlByRepo).length <= 1;
    const { heading, meta: baseMeta } = deriveCardHeading(ctx);
    const difficulty = formatComplexity(ctx.iteration?.complexity);
    const meta = difficulty ? `${baseMeta} · Difficulty: ${difficulty}` : baseMeta;

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${TIER_CSS_VAR})`} mode="determinate" sublabel="TASK">
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
            <CommitChips repos={ctx.repos} compareUrlByRepo={ctx.compareUrlByRepo} singleRepo={singleRepo} variant="button" iconCssVar={TIER_CSS_VAR} />
          </CardControlsRow>
        </ControlsSlot>
      </>
    );
  },
};
