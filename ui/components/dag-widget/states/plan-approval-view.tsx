import { FileCheck } from 'lucide-react';
import { ApproveGateButton } from '@/components/dashboard';
import { Ring } from '../ring';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { CardControlsRow, DocButton } from '../card-controls';
import type { StateView } from '../types';
import type { AnyProjectState } from '@/types/state';

const TIER_CSS_VAR = '--tier-planning';

/** Reads the master plan's doc path from the top-level `master_plan` step, independent of the active `plan_approval_gate` node. */
export function deriveMasterPlanDocPath(state: AnyProjectState): string | null {
  const node = state.graph.nodes['master_plan'];
  return node && node.kind === 'step' ? node.doc_path : null;
}

/**
 * The Plan Approval milestone view (`plan_approval_gate`, `gate_active`).
 * Blue tier, full ring (a determinate arc at its max — the plan is ready, not
 * partial) with a centered ready glyph and a "READY" sublabel. The one card
 * state with a primary action: it reuses `ApproveGateButton` rather than
 * re-implementing the gate POST, alongside a secondary `DocButton` for the
 * master plan doc.
 */
export const planApprovalView: StateView = {
  id: 'plan-approval',
  render(ctx) {
    const planDocPath = deriveMasterPlanDocPath(ctx.state);
    const heading = 'Ready for Approval';
    const meta = planDocPath ?? 'Master Plan';

    return (
      <>
        <RingSlot>
          <Ring value={1} max={1} color={`var(${TIER_CSS_VAR})`} mode="determinate" sublabel="READY">
            <FileCheck className="h-6 w-6" style={{ color: `var(${TIER_CSS_VAR})` }} aria-hidden="true" />
          </Ring>
        </RingSlot>
        <HeadingSlot heading={heading} hasMeta={meta !== null} />
        <MetaSlot meta={meta} />
        <ControlsSlot>
          <CardControlsRow>
            <ApproveGateButton
              gateEvent="plan_approved"
              projectName={ctx.projectName}
              documentName={planDocPath ?? ctx.projectName}
              label="Approve"
            />
            <DocButton path={planDocPath} label="Master Plan" onDocClick={ctx.onDocClick} iconCssVar={TIER_CSS_VAR} />
          </CardControlsRow>
        </ControlsSlot>
      </>
    );
  },
};
