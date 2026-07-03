import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, X, AlertTriangle, Clock, HelpCircle } from 'lucide-react';
import { DocumentLink, ExternalLink } from '@/components/documents';
import { Ring } from '../ring';
import { RingSlot, TitleSlot, ControlsSlot } from '../card-slots';
import type { StateView } from '../types';

const TIER_CSS_VAR = '--tier-complete';

/**
 * Overrides `--primary` for the wrapped subtree so `DocumentLink`'s
 * hard-coded `text-primary` icon/label resolve to this state's tier color —
 * same technique the work-state views use.
 */
const TIER_TINT_STYLE = { '--primary': `var(${TIER_CSS_VAR})` } as CSSProperties;

/**
 * Ring arc `{value, max}` from the resolver's phase progress. Falls back to
 * an empty-but-valid `{0, 1}` domain (never `{0, 0}`, which would hand the
 * ring a degenerate arc domain) when no phase progress is derivable yet.
 */
export function deriveRingArc(
  phaseProgress: { completed: number; total: number } | null,
): { value: number; max: number } {
  if (phaseProgress === null || phaseProgress.total <= 0) return { value: 0, max: 1 };
  return { value: phaseProgress.completed, max: phaseProgress.total };
}

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

function parsePrLabel(url: string): string {
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `PR #${match[1]}` : 'PR';
}

/**
 * The Final Review milestone view (`final_review`). Green tier, determinate
 * ring showing phase position across the run, centered on the review's
 * verdict tone. Controls surface the report and — when present — the run's
 * PR link; no commit chip at this milestone.
 */
export const finalReviewView: StateView = {
  id: 'final-review',
  render(ctx) {
    const arc = deriveRingArc(ctx.phaseProgress);
    const docPath = ctx.node && ctx.node.kind === 'step' ? ctx.node.doc_path : null;
    const verdict = ctx.node && ctx.node.kind === 'step' ? ctx.node.verdict ?? null : null;
    const tone = deriveVerdictTone(verdict);

    return (
      <>
        <RingSlot>
          <Ring value={arc.value} max={arc.max} color={`var(${TIER_CSS_VAR})`} mode="determinate">
            <tone.Icon className="h-6 w-6" style={{ color: `var(${tone.cssVar})` }} aria-hidden="true" />
          </Ring>
        </RingSlot>
        <TitleSlot>
          <span className="truncate text-base font-medium text-foreground">Final Review</span>
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
