import { CommitChips } from '@/components/dag-timeline/commit-chips';
import { Ring } from '../ring';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { CardControlsRow, DocButton } from '../card-controls';
import type { CorrectiveScope, StateView } from '../types';
import type { AnyProjectState, CorrectiveTaskEntry, StepNodeState } from '@/types/state';
import { deriveRingArc } from './shared';
import { deriveCardHeading } from './heading';
import { resolveMaxRetriesPerTask, DEFAULT_MAX_RETRIES_PER_TASK, deriveRetryBudget } from '@/lib/max-retries-resolver';

const TIER_CSS_VAR = '--status-failed';

export { resolveMaxRetriesPerTask, DEFAULT_MAX_RETRIES_PER_TASK };

/** `{ handoff, report }` control labels for each corrective scope. `handoff: null` at `'final'` — there is no handoff at that scope. */
const CORRECTIVE_LABELS: Record<CorrectiveScope, { handoff: string | null; report: string }> = {
  task: { handoff: 'Task Handoff', report: 'Review Report' },
  phase: { handoff: 'Phase Plan', report: 'Phase Report' },
  final: { handoff: null, report: 'Final Review' },
};

/**
 * `{attempt}/{maxRetries}` retry-budget label for the ring center. `null`
 * when no corrective entry resolved (a malformed/stale `.ct{N}.` path) or the
 * entry predates the current window — the ring center falls back to a
 * neutral glyph in that case. `budgetOrigin` is the host's
 * `corrective_budget_origin` (0 for iteration hosts, non-zero for a
 * final-scope host after a `final_rejected` reopen).
 */
export function deriveRetryBudgetLabel(
  correctiveEntry: CorrectiveTaskEntry | undefined,
  state: AnyProjectState,
  budgetOrigin = 0,
): string | null {
  return deriveRetryBudget(correctiveEntry, state, budgetOrigin)?.label ?? null;
}

/**
 * Ring arc `{ value, max }` for the retry budget itself — the window-relative
 * attempt over `maxRetries`, the same quantity `deriveRetryBudgetLabel`
 * renders as the ring's center text. Deliberately not task or phase progress:
 * a phase-level corrective can fire after its phase's task loop already reads
 * 100%, which would otherwise paint a full ring beside a center label
 * reading a small fraction. Shares `deriveRingArc`'s degenerate-domain
 * fallback (`{ 0, 1 }`) when no corrective entry resolved, the retry ceiling
 * is non-positive, or the entry predates the current retry window.
 */
export function deriveRetryArc(
  correctiveEntry: CorrectiveTaskEntry | undefined,
  state: AnyProjectState,
  budgetOrigin = 0,
): { value: number; max: number } {
  const budget = deriveRetryBudget(correctiveEntry, state, budgetOrigin);
  if (!budget) return deriveRingArc(null);
  return deriveRingArc({ completed: budget.attempt, total: budget.max });
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
 * Controls surface the corrective's own handoff doc (task/phase scope only —
 * `'final'` has no handoff, so that control is omitted rather than rendered
 * disabled), the review report that triggered it, and a commit chip scoped
 * to the corrective's own repos.
 */
export const correctiveView: StateView = {
  id: 'corrective',
  render(ctx) {
    const singleRepo = Object.keys(ctx.compareUrlByRepo).length <= 1;

    let reviewReportPath: string | null;
    let budgetOrigin = 0;
    switch (ctx.correctiveScope) {
      case 'phase':
        reviewReportPath = (ctx.iteration?.nodes['phase_review'] as StepNodeState | undefined)?.doc_path ?? null;
        break;
      case 'final': {
        // No enclosing iteration at this scope — read the top-level review
        // step directly rather than `ctx.iteration`, which is undefined here.
        const finalReviewNode = ctx.state.graph.nodes['final_review'] as StepNodeState | undefined;
        reviewReportPath = finalReviewNode?.doc_path ?? null;
        budgetOrigin = finalReviewNode?.corrective_budget_origin ?? 0;
        break;
      }
      default:
        reviewReportPath = (ctx.iteration?.nodes['code_review'] as StepNodeState | undefined)?.doc_path ?? null;
    }

    const arc = deriveRetryArc(ctx.correctiveEntry, ctx.state, budgetOrigin);
    const retryBudget = deriveRetryBudgetLabel(ctx.correctiveEntry, ctx.state, budgetOrigin);

    const labels = CORRECTIVE_LABELS[ctx.correctiveScope ?? 'task'];
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
            {labels.handoff !== null && (
              <DocButton
                path={ctx.correctiveEntry?.doc_path ?? null}
                label={labels.handoff}
                onDocClick={ctx.onDocClick}
                iconCssVar={TIER_CSS_VAR}
              />
            )}
            <DocButton
              path={reviewReportPath}
              label={labels.report}
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
