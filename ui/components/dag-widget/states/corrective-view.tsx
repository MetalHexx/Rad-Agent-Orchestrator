import type { CSSProperties } from 'react';
import { SpinnerBadge } from '@/components/badges';
import { DocumentLink } from '@/components/documents';
import { CommitChips } from '@/components/dag-timeline/commit-chips';
import { Ring } from '../ring';
import { RingSlot, TitleSlot, ControlsSlot } from '../card-slots';
import type { StateView } from '../types';
import type { AnyProjectState, CorrectiveTaskEntry, IterationEntry } from '@/types/state';

const TIER_CSS_VAR = '--status-failed';

/**
 * Overrides `--primary` for the wrapped subtree so `DocumentLink`'s
 * hard-coded `text-primary` icon/label resolve to this state's tier color
 * instead of the app default — `DocumentLink` itself stays untouched. Works
 * because the compiled `.text-primary` rule reads `color: var(--primary)`
 * directly (Tailwind v4 `@theme inline`), so redefining `--primary` on an
 * ancestor retints every `text-primary` descendant.
 */
const TIER_TINT_STYLE = { '--primary': `var(${TIER_CSS_VAR})` } as CSSProperties;

/**
 * Fallback retry ceiling used when a snapshot omits
 * `config.limits.max_retries_per_task` — typed as required on both
 * `StateConfigLimits` (v5) and `V6StateConfigLimits` (v6), but not
 * guaranteed at runtime for a stale or hand-edited state file. Matches the
 * value used throughout this codebase's own fixtures/tests as the de facto
 * default retry budget.
 */
export const DEFAULT_MAX_RETRIES_PER_TASK = 2;

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

/** Resolves the max corrective retries from the state's config snapshot, with the documented fallback above. */
export function resolveMaxRetriesPerTask(state: AnyProjectState): number {
  return state.config.limits.max_retries_per_task ?? DEFAULT_MAX_RETRIES_PER_TASK;
}

/**
 * `{correctiveIndex}/{maxRetries}` retry-budget label for the ring center.
 * `null` when no corrective entry resolved (a malformed/stale `.ct{N}.`
 * path) — the ring center falls back to a neutral glyph in that case.
 */
export function deriveRetryBudgetLabel(
  correctiveEntry: CorrectiveTaskEntry | undefined,
  state: AnyProjectState,
): string | null {
  if (!correctiveEntry) return null;
  return `${correctiveEntry.index}/${resolveMaxRetriesPerTask(state)}`;
}

/**
 * The Corrective work-state view (a `corrective_tasks[]` entry, identified
 * by a `.ct{N}.` path segment). Red tier. Ring center shows the retry
 * budget (display only, never a button); controls surface the corrective's
 * own task handoff, the review report that triggered it, and a commit chip
 * scoped to the corrective's own repos.
 */
export const correctiveView: StateView = {
  id: 'corrective',
  render(ctx) {
    const taskNumber = deriveTaskNumber(ctx.iteration);
    const arc = deriveRingArc(ctx.phaseProgress);
    const singleRepo = Object.keys(ctx.compareUrlByRepo).length <= 1;
    const retryBudget = deriveRetryBudgetLabel(ctx.correctiveEntry, ctx.state);
    const reviewNode = ctx.iteration?.nodes['code_review'];
    const reviewReportPath = reviewNode && 'doc_path' in reviewNode ? reviewNode.doc_path : null;

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${TIER_CSS_VAR})`} mode="determinate">
            <span className="text-sm font-semibold text-foreground">{retryBudget ?? '—'}</span>
          </Ring>
        </RingSlot>
        <TitleSlot>
          <SpinnerBadge label="Correcting" cssVar={TIER_CSS_VAR} isSpinning />
          <span className="truncate text-sm text-muted-foreground">
            {ctx.phaseName ?? 'Phase'}
            {taskNumber !== null && ` · Task ${taskNumber}`}
          </span>
          {ctx.correctiveEntry && (
            <span className="truncate text-xs text-muted-foreground">{ctx.correctiveEntry.reason}</span>
          )}
        </TitleSlot>
        <ControlsSlot>
          <span className="inline-flex items-center gap-2" style={TIER_TINT_STYLE}>
            <DocumentLink
              path={ctx.correctiveEntry?.doc_path ?? null}
              label="Task Handoff"
              onDocClick={ctx.onDocClick}
            />
            <DocumentLink path={reviewReportPath} label="Review Report" onDocClick={ctx.onDocClick} />
          </span>
          <CommitChips repos={ctx.repos} compareUrlByRepo={ctx.compareUrlByRepo} singleRepo={singleRepo} />
        </ControlsSlot>
      </>
    );
  },
};
