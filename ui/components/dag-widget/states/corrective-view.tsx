import { CommitChips } from '@/components/dag-timeline/commit-chips';
import { Ring } from '../ring';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { CardControlsRow, DocButton } from '../card-controls';
import type { StateView } from '../types';
import type { AnyProjectState, CorrectiveTaskEntry, StepNodeState } from '@/types/state';
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
 * Ring arc `{ value, max }` for the retry budget itself — `correctiveIndex`
 * over `maxRetries`, the same quantity `deriveRetryBudgetLabel` renders as
 * the ring's center text. Deliberately not task or phase progress: a
 * phase-level corrective can fire after its phase's task loop already reads
 * 100%, which would otherwise paint a full ring beside a center label
 * reading a small fraction. Shares `deriveRingArc`'s degenerate-domain
 * fallback (`{ 0, 1 }`) when no corrective entry resolved or the retry
 * ceiling is non-positive.
 */
export function deriveRetryArc(
  correctiveEntry: CorrectiveTaskEntry | undefined,
  state: AnyProjectState,
): { value: number; max: number } {
  if (!correctiveEntry) return deriveRingArc(null);
  return deriveRingArc({ completed: correctiveEntry.index, total: resolveMaxRetriesPerTask(state) });
}

/**
 * The Corrective work-state view (a `corrective_tasks[]` entry, identified
 * by a `.ct{N}.` path segment). Red tier. Ring center shows the retry
 * budget under a "RETRY" sublabel (display only, never a button), and the
 * arc plots that same retry budget (`correctiveIndex`/`maxRetries`) — unlike
 * the work-state views, this arc is deliberately not task/phase progress,
 * since the center already renders the exact ratio the ring visualizes and a
 * mismatched source would read as a fill disconnected from the number beside
 * it. Heading is `Correcting: <task title>` (via `deriveCardHeading`'s
 * state-name prefix); the visible meta line stays the short `Phase N · Task
 * M` — a corrective's own reason is free text and can run long (e.g. "Fix
 * the null dereference in the auth guard that review flagged, and add a
 * regression test"), which overran the card when folded into the visible
 * line. The full `meta — reason` string still surfaces as the meta's hover
 * title, so the detail isn't lost, just not forced onto the card face.
 * Controls surface the corrective's own task handoff, the review report that
 * triggered it, and a commit chip scoped to the corrective's own repos.
 */
export const correctiveView: StateView = {
  id: 'corrective',
  render(ctx) {
    const arc = deriveRetryArc(ctx.correctiveEntry, ctx.state);
    const singleRepo = Object.keys(ctx.compareUrlByRepo).length <= 1;
    const retryBudget = deriveRetryBudgetLabel(ctx.correctiveEntry, ctx.state);
    const reviewReportPath = ctx.isPhaseCorrective
      ? (ctx.iteration?.nodes['phase_review'] as StepNodeState | undefined)?.doc_path ?? null
      : (ctx.iteration?.nodes['code_review'] as StepNodeState | undefined)?.doc_path ?? null;
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
        <HeadingSlot heading={heading} hasMeta={meta !== null} />
        <MetaSlot meta={meta} title={metaWithReason ?? undefined} />
        <ControlsSlot>
          <CardControlsRow>
            <DocButton
              path={ctx.correctiveEntry?.doc_path ?? null}
              label={ctx.isPhaseCorrective ? 'Phase Plan' : 'Task Handoff'}
              onDocClick={ctx.onDocClick}
              iconCssVar={TIER_CSS_VAR}
            />
            <DocButton
              path={reviewReportPath}
              label={ctx.isPhaseCorrective ? 'Phase Report' : 'Review Report'}
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
