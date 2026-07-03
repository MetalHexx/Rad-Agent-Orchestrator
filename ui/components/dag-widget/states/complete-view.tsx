import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { DocumentLink, ExternalLink } from '@/components/documents';
import { Ring } from '../ring';
import { RingSlot, TitleSlot, ControlsSlot } from '../card-slots';
import type { StateView } from '../types';
import type { AnyProjectState } from '@/types/state';

const TIER_CSS_VAR = '--tier-complete';

/**
 * Overrides `--primary` for the wrapped subtree so `DocumentLink`'s
 * hard-coded `text-primary` icon/label resolve to this state's tier color —
 * same technique the work-state views use.
 */
const TIER_TINT_STYLE = { '--primary': `var(${TIER_CSS_VAR})` } as CSSProperties;

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
 * Reads the final review's doc path and verdict from the top-level
 * `final_review` node directly, independent of the resolved current node —
 * `graph.status === 'completed'` wins resolution regardless of the active
 * node (see the resolver), so `current_node_path` may point anywhere (or
 * nowhere) by the time the run completes.
 */
export function deriveFinalReviewInfo(state: AnyProjectState): { docPath: string | null; verdict: string | null } {
  const node = state.graph.nodes['final_review'];
  if (!node || node.kind !== 'step') return { docPath: null, verdict: null };
  return { docPath: node.doc_path, verdict: node.verdict ?? null };
}

function parsePrLabel(url: string): string {
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `PR #${match[1]}` : 'PR';
}

/**
 * The Complete milestone view (`graph.status === 'completed'`). Green tier,
 * full ring (a determinate arc at its max) with a centered, unconditional
 * `Check` — the run's satisfying end-cap, regardless of the final verdict's
 * actual value. Controls surface the report and — when present — the PR
 * link; no commit chip at this milestone.
 */
export const completeView: StateView = {
  id: 'complete',
  render(ctx) {
    const { docPath, verdict } = deriveFinalReviewInfo(ctx.state);
    const tone = deriveVerdictTone(verdict);

    return (
      <>
        <RingSlot>
          <Ring value={1} max={1} color={`var(${TIER_CSS_VAR})`} mode="determinate">
            <Check className="h-6 w-6" style={{ color: `var(${TIER_CSS_VAR})` }} aria-hidden="true" />
          </Ring>
        </RingSlot>
        <TitleSlot>
          <span className="truncate text-base font-medium text-foreground">Run complete</span>
          <span className="truncate text-sm font-medium" style={{ color: `var(${tone.cssVar})` }}>
            {tone.label}
          </span>
        </TitleSlot>
        <ControlsSlot>
          <span className="inline-flex items-center gap-2" style={TIER_TINT_STYLE}>
            <DocumentLink path={docPath} label="Report" onDocClick={ctx.onDocClick} />
          </span>
          {ctx.prUrl !== null && (
            <ExternalLink href={ctx.prUrl} label={parsePrLabel(ctx.prUrl)} icon="git-pull-request" />
          )}
        </ControlsSlot>
      </>
    );
  },
};
