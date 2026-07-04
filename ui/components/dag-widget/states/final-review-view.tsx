import type { LucideIcon } from 'lucide-react';
import { Check, X, AlertTriangle, Clock, HelpCircle } from 'lucide-react';
import { ApproveGateButton } from '@/components/dashboard';
import { Ring } from '../ring';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { CardControlsRow, DocButton, ExternalLinkButton } from '../card-controls';
import type { StateView } from '../types';
import { deriveRingArc, parsePrLabel, deriveFinalReviewInfo, deriveFinalGatePending } from './shared';

interface VerdictTone {
  /** Short label for the ring center (fits inside the ring). */
  label: string;
  /** One-line descriptive sentence for the card's meta line. */
  detail: string;
  cssVar: string;
  Icon: LucideIcon;
}

const VERDICT_TONE: Record<string, VerdictTone> = {
  approved: { label: 'Review Passed', detail: 'The reviewer approved the work.', cssVar: '--verdict-approved', Icon: Check },
  changes_requested: { label: 'Needs Work', detail: 'The reviewer found issues.', cssVar: '--verdict-changes-requested', Icon: AlertTriangle },
  rejected: { label: 'Rejected', detail: 'The reviewer rejected the work.', cssVar: '--verdict-rejected', Icon: X },
};

/**
 * Maps a review verdict to its display tone: a short `label` for the ring
 * center and a descriptive `detail` sentence for the meta line. `verdict` is a
 * loose `string | null` at the source (`StepNodeState.verdict`), not the
 * stricter `ReviewVerdict` enum, so a recognized value maps to its tone and
 * anything else — an unrecognized string or `null` (not yet reviewed) — falls
 * back to a neutral tone rather than throwing or rendering nothing.
 */
export function deriveVerdictTone(verdict: string | null): VerdictTone {
  if (verdict === null) return { label: 'Pending', detail: 'Review in progress.', cssVar: '--status-not-started', Icon: Clock };
  return VERDICT_TONE[verdict] ?? { label: verdict, detail: 'Review complete.', cssVar: '--status-not-started', Icon: HelpCircle };
}

/**
 * The Final Review milestone view (`final_review`). The whole card is tinted to
 * the review's VERDICT rather than a fixed tier — green when the review passed,
 * amber when it needs work, red when rejected — so the ring, its center icon,
 * and the control icons all read as one status color. The determinate ring
 * shows phase position across the run, centered on the verdict icon with the
 * short verdict label (`Review Passed` / `Needs Work` / `Rejected`) as its
 * sublabel; the meta line carries the longer detail sentence.
 * Reads the report + verdict from the top-level `final_review` node via
 * `deriveFinalReviewInfo` rather than `ctx.node` — once the resolver folds
 * `final_pr` into this view, `ctx.node` resolves to the PR node instead, so
 * reading through the top-level node keeps this view correct regardless of
 * which leaf is active. Controls surface the report and — when present —
 * the run's PR link; no commit chip at this milestone. When the run is parked
 * at the final-approval gate (`deriveFinalGatePending`), the card also carries
 * the primary Approve action — reusing `ApproveGateButton` (the same primitive
 * the plan-approval card and the timeline use) rather than re-implementing the
 * gate POST. The Approve action is gated because this view folds the whole
 * completion phase; unlike plan-approval it must not render Approve until the
 * gate is actually active.
 */
export const finalReviewView: StateView = {
  id: 'final-review',
  render(ctx) {
    const arc = deriveRingArc(ctx.phaseProgress);
    const { docPath, verdict } = deriveFinalReviewInfo(ctx.state);
    const tone = deriveVerdictTone(verdict);
    const heading = 'Final Review';
    const meta = tone.detail;
    const gatePending = deriveFinalGatePending(ctx.state);

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${tone.cssVar})`} mode="determinate" sublabel={tone.label}>
            <tone.Icon className="h-6 w-6" style={{ color: `var(${tone.cssVar})` }} aria-hidden="true" />
          </Ring>
        </RingSlot>
        <HeadingSlot heading={heading} hasMeta={meta !== null} />
        <MetaSlot meta={meta} />
        <ControlsSlot>
          <CardControlsRow>
            {gatePending && (
              <ApproveGateButton
                gateEvent="final_approved"
                projectName={ctx.projectName}
                documentName={docPath ?? ctx.projectName}
                label="Approve"
                variant="outline"
                icon={Check}
                iconCssVar={tone.cssVar}
              />
            )}
            <DocButton path={docPath} label="Report" onDocClick={ctx.onDocClick} iconCssVar={tone.cssVar} />
            {ctx.prUrl !== null && (
              <ExternalLinkButton href={ctx.prUrl} label={parsePrLabel(ctx.prUrl)} iconCssVar={tone.cssVar} />
            )}
          </CardControlsRow>
        </ControlsSlot>
      </>
    );
  },
};
