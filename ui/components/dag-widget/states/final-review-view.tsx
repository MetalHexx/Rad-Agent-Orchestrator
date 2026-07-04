import type { LucideIcon } from 'lucide-react';
import { Check, X, AlertTriangle, Clock, HelpCircle } from 'lucide-react';
import { ExternalLink } from '@/components/documents';
import { Ring } from '../ring';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { CardControlsRow, DocButton } from '../card-controls';
import type { StateView } from '../types';
import { deriveRingArc, parsePrLabel, deriveFinalReviewInfo } from './shared';

const TIER_CSS_VAR = '--tier-complete';

const VERDICT_TONE: Record<string, { label: string; cssVar: string; Icon: LucideIcon }> = {
  approved: { label: 'Approved', cssVar: '--verdict-approved', Icon: Check },
  changes_requested: { label: 'Changes Requested', cssVar: '--verdict-changes-requested', Icon: AlertTriangle },
  rejected: { label: 'Rejected', cssVar: '--verdict-rejected', Icon: X },
};

/**
 * Maps a review verdict to its display tone. `verdict` is a loose
 * `string | null` at the source (`StepNodeState.verdict`), not the stricter
 * `ReviewVerdict` enum, so a recognized value maps to its tone and anything
 * else — an unrecognized string or `null` (not yet reviewed) — falls back to
 * a neutral tone rather than throwing or rendering nothing.
 */
export function deriveVerdictTone(verdict: string | null): { label: string; cssVar: string; Icon: LucideIcon } {
  if (verdict === null) return { label: 'Pending', cssVar: '--status-not-started', Icon: Clock };
  return VERDICT_TONE[verdict] ?? { label: verdict, cssVar: '--status-not-started', Icon: HelpCircle };
}

/**
 * The Final Review milestone view (`final_review`). Green tier, determinate
 * ring showing phase position across the run, centered on the review's
 * verdict tone with the verdict label doubling as the ring sublabel.
 * Reads the report + verdict from the top-level `final_review` node via
 * `deriveFinalReviewInfo` rather than `ctx.node` — once the resolver folds
 * `final_pr` into this view, `ctx.node` resolves to the PR node instead, so
 * reading through the top-level node keeps this view correct regardless of
 * which leaf is active. Controls surface the report and — when present —
 * the run's PR link; no commit chip at this milestone.
 */
export const finalReviewView: StateView = {
  id: 'final-review',
  render(ctx) {
    const arc = deriveRingArc(ctx.phaseProgress);
    const { docPath, verdict } = deriveFinalReviewInfo(ctx.state);
    const tone = deriveVerdictTone(verdict);
    const heading = 'Final Review';
    const meta = tone.label;

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${TIER_CSS_VAR})`} mode="determinate" sublabel={tone.label}>
            <tone.Icon className="h-6 w-6" style={{ color: `var(${tone.cssVar})` }} aria-hidden="true" />
          </Ring>
        </RingSlot>
        <HeadingSlot heading={heading} hasMeta={meta !== null} />
        <MetaSlot meta={meta} />
        <ControlsSlot>
          <CardControlsRow>
            <DocButton path={docPath} label="Report" onDocClick={ctx.onDocClick} iconCssVar={TIER_CSS_VAR} />
            {ctx.prUrl !== null && (
              <ExternalLink href={ctx.prUrl} label={parsePrLabel(ctx.prUrl)} icon="git-pull-request" />
            )}
          </CardControlsRow>
        </ControlsSlot>
      </>
    );
  },
};
