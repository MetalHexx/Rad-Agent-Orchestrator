import type { CSSProperties } from 'react';
import { FileCheck } from 'lucide-react';
import { DocumentLink } from '@/components/documents';
import { ApproveGateButton } from '@/components/dashboard';
import { Ring } from '../ring';
import { RingSlot, TitleSlot, ControlsSlot } from '../card-slots';
import type { StateView } from '../types';
import type { AnyProjectState } from '@/types/state';

const TIER_CSS_VAR = '--tier-planning';

/**
 * Retints `DocumentLink`'s hard-coded `text-primary` icon/label to the
 * muted-foreground tone for this state's secondary action — the primary
 * action is the `ApproveGateButton` beside it. Same `--primary`-override
 * technique the work-state views use to tint toward their own tier color;
 * here it points at `--muted-foreground` instead.
 */
const MUTED_TINT_STYLE = { '--primary': 'var(--muted-foreground)' } as CSSProperties;

/** Reads the master plan's doc path from the top-level `master_plan` step, independent of the active `plan_approval_gate` node. */
export function deriveMasterPlanDocPath(state: AnyProjectState): string | null {
  const node = state.graph.nodes['master_plan'];
  return node && node.kind === 'step' ? node.doc_path : null;
}

/**
 * The Plan Approval milestone view (`plan_approval_gate`, `gate_active`).
 * Blue tier, full ring (a determinate arc at its max — the plan is ready, not
 * partial) with a centered ready glyph. The one card state with a primary
 * action: it reuses `ApproveGateButton` rather than re-implementing the gate
 * POST. Ring-centric and cohesive — no bespoke chrome beyond the two controls.
 */
export const planApprovalView: StateView = {
  id: 'plan-approval',
  render(ctx) {
    const planDocPath = deriveMasterPlanDocPath(ctx.state);

    return (
      <>
        <RingSlot>
          <Ring value={1} max={1} color={`var(${TIER_CSS_VAR})`} mode="determinate">
            <FileCheck className="h-6 w-6" style={{ color: `var(${TIER_CSS_VAR})` }} aria-hidden="true" />
          </Ring>
        </RingSlot>
        <TitleSlot>
          <span className="truncate text-base font-medium text-foreground">Plan ready for approval</span>
          <span className="truncate text-sm text-muted-foreground">{planDocPath ?? 'Master Plan'}</span>
        </TitleSlot>
        <ControlsSlot>
          <ApproveGateButton
            gateEvent="plan_approved"
            projectName={ctx.projectName}
            documentName={planDocPath ?? ctx.projectName}
            label="Approve"
          />
          <span style={MUTED_TINT_STYLE}>
            <DocumentLink path={planDocPath} label="Master Plan" onDocClick={ctx.onDocClick} />
          </span>
        </ControlsSlot>
      </>
    );
  },
};
