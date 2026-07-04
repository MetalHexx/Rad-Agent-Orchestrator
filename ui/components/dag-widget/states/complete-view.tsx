import { Check } from 'lucide-react';
import { ExternalLink } from '@/components/documents';
import { Ring } from '../ring';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { CardControlsRow, DocButton } from '../card-controls';
import type { StateView } from '../types';
import { parsePrLabel, deriveFinalReviewInfo } from './shared';

const TIER_CSS_VAR = '--tier-complete';

const VERDICT_TONE: Record<string, { label: string; cssVar: string }> = {
  approved: { label: 'Approved', cssVar: '--verdict-approved' },
  changes_requested: { label: 'Changes Requested', cssVar: '--verdict-changes-requested' },
  rejected: { label: 'Rejected', cssVar: '--verdict-rejected' },
};

/**
 * Maps a review verdict to its display tone. `verdict` is a loose
 * `string | null` at the source (`StepNodeState.verdict`), not the stricter
 * `ReviewVerdict` enum, so a recognized value maps to its tone and anything
 * else — an unrecognized string or `null` — falls back to a neutral tone
 * rather than throwing or rendering nothing.
 */
export function deriveVerdictTone(verdict: string | null): { label: string; cssVar: string } {
  if (verdict === null) return { label: 'Pending', cssVar: '--status-not-started' };
  return VERDICT_TONE[verdict] ?? { label: verdict, cssVar: '--status-not-started' };
}

/**
 * The Complete milestone view (`graph.status === 'completed'`). Green tier,
 * full ring (a determinate arc at its max) with a centered, unconditional
 * `Check` and "SHIPPED" sublabel — the run's satisfying end-cap, regardless
 * of the final verdict's actual value (the verdict itself still surfaces in
 * the meta line). Reads the report + verdict via `deriveFinalReviewInfo`
 * (shared with Final Review) from the top-level `final_review` node, rather
 * than the resolved current node, since `graph.status === 'completed'` wins
 * resolution regardless of the active node. Controls surface the report and
 * — when present — the PR link; no commit chip at this milestone.
 */
export const completeView: StateView = {
  id: 'complete',
  render(ctx) {
    const { docPath, verdict } = deriveFinalReviewInfo(ctx.state);
    const tone = deriveVerdictTone(verdict);
    const heading = 'Run Complete';
    const meta = tone.label;

    return (
      <>
        <RingSlot>
          <Ring value={1} max={1} color={`var(${TIER_CSS_VAR})`} mode="determinate" sublabel="SHIPPED">
            <Check className="h-6 w-6" style={{ color: `var(${TIER_CSS_VAR})` }} aria-hidden="true" />
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
