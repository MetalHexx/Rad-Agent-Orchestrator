import type { CSSProperties } from 'react';
import { SpinnerBadge } from '@/components/badges';
import { DocumentLink } from '@/components/documents';
import { CommitChips } from '@/components/dag-timeline/commit-chips';
import { Ring } from '../ring';
import { RingSlot, TitleSlot, ControlsSlot } from '../card-slots';
import type { StateView } from '../types';
import type { IterationEntry } from '@/types/state';

const TIER_CSS_VAR = '--tier-review';

/**
 * Overrides `--primary` for the wrapped subtree so `DocumentLink`'s
 * hard-coded `text-primary` icon/label resolve to this state's tier color
 * instead of the app default — `DocumentLink` itself stays untouched. Works
 * because the compiled `.text-primary` rule reads `color: var(--primary)`
 * directly (Tailwind v4 `@theme inline`), so redefining `--primary` on an
 * ancestor retints every `text-primary` descendant.
 */
const TIER_TINT_STYLE = { '--primary': `var(${TIER_CSS_VAR})` } as CSSProperties;

/** 1-based task number for display, derived from the active task iteration. */
export function deriveTaskNumber(iteration: IterationEntry | undefined): number | null {
  return iteration ? iteration.index + 1 : null;
}

/**
 * Ring arc `{value, max}` from the resolver's phase task-progress. Falls
 * back to an empty-but-valid `{0, 1}` domain (never `{0, 0}`, which would
 * hand the ring a degenerate arc domain) when no phase progress is derivable
 * yet.
 */
export function deriveRingArc(
  phaseProgress: { completed: number; total: number } | null,
): { value: number; max: number } {
  if (phaseProgress === null || phaseProgress.total <= 0) return { value: 0, max: 1 };
  return { value: phaseProgress.completed, max: phaseProgress.total };
}

/**
 * The Reviewing work-state view (`code_review`). Purple tier. Ring center
 * shows the current task number; controls surface the task handoff, the
 * task's own code-review doc, and a commit chip for the iteration's repos.
 */
export const reviewingView: StateView = {
  id: 'reviewing',
  render(ctx) {
    const taskNumber = deriveTaskNumber(ctx.iteration);
    const arc = deriveRingArc(ctx.phaseProgress);
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
