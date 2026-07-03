import { SpinnerBadge } from '@/components/badges';
import { DocumentLink } from '@/components/documents';
import { CommitChips } from '@/components/dag-timeline/commit-chips';
import { Ring } from '../ring';
import { RingSlot, TitleSlot, ControlsSlot } from '../card-slots';
import type { StateView } from '../types';
import type { AnyProjectState, CorrectiveTaskEntry } from '@/types/state';
import { tierTintStyle, deriveRingArc, deriveTaskNumber } from './shared';

const TIER_CSS_VAR = '--status-failed';
const TIER_TINT_STYLE = tierTintStyle(TIER_CSS_VAR);

/**
 * Fallback retry ceiling used when a snapshot omits
 * `config.limits.max_retries_per_task` — typed as required on both
 * `StateConfigLimits` (v5) and `V6StateConfigLimits` (v6), but not
 * guaranteed at runtime for a stale or hand-edited state file. Matches the
 * value used throughout this codebase's own fixtures/tests as the de facto
 * default retry budget.
 */
export const DEFAULT_MAX_RETRIES_PER_TASK = 2;

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
    const arc = deriveRingArc(ctx.taskProgress);
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
