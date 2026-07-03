import { CommitChips } from '@/components/dag-timeline/commit-chips';
import { Ring } from '../ring';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { CardControlsRow, DocButton } from '../card-controls';
import type { StateView } from '../types';
import type { AnyProjectState, CorrectiveTaskEntry } from '@/types/state';
import { deriveRingArc } from './shared';
import { deriveCardHeading } from './heading';

const TIER_CSS_VAR = '--status-failed';

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
 * budget under a "RETRY" sublabel (display only, never a button). Heading is
 * the task title; meta folds the corrective's own short reason in alongside
 * `Phase N · Task M`. Controls surface the corrective's own task handoff,
 * the review report that triggered it, and a commit chip scoped to the
 * corrective's own repos.
 */
export const correctiveView: StateView = {
  id: 'corrective',
  render(ctx) {
    const arc = deriveRingArc(ctx.taskProgress);
    const singleRepo = Object.keys(ctx.compareUrlByRepo).length <= 1;
    const retryBudget = deriveRetryBudgetLabel(ctx.correctiveEntry, ctx.state);
    const reviewNode = ctx.iteration?.nodes['code_review'];
    const reviewReportPath = reviewNode && 'doc_path' in reviewNode ? reviewNode.doc_path : null;
    const { heading, meta } = deriveCardHeading(ctx);
    const reason = ctx.correctiveEntry?.reason ?? null;
    const metaWithReason =
      reason !== null ? [meta, reason].filter((part): part is string => part !== null).join(' — ') : meta;

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${TIER_CSS_VAR})`} mode="determinate" sublabel="RETRY">
            <span className="text-sm font-semibold text-foreground">{retryBudget ?? '—'}</span>
          </Ring>
        </RingSlot>
        <HeadingSlot heading={heading} hasMeta={metaWithReason !== null} />
        <MetaSlot meta={metaWithReason} />
        <ControlsSlot>
          <CardControlsRow>
            <DocButton
              path={ctx.correctiveEntry?.doc_path ?? null}
              label="Task Handoff"
              onDocClick={ctx.onDocClick}
              iconCssVar={TIER_CSS_VAR}
            />
            <DocButton
              path={reviewReportPath}
              label="Review Report"
              onDocClick={ctx.onDocClick}
              iconCssVar={TIER_CSS_VAR}
            />
            <CommitChips repos={ctx.repos} compareUrlByRepo={ctx.compareUrlByRepo} singleRepo={singleRepo} />
          </CardControlsRow>
        </ControlsSlot>
      </>
    );
  },
};
