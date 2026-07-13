// graph-service/tests/fixtures/plan-relay.ts
//
// The orchestrator-role `driveToQuiescence` `resolve` callback for the plan subgraph's own
// external-actor node types (`rad-orc:master_plan`/`rad-orc:plan_audit`/`rad-orc:plan_corrective`/
// the plan-level `rad-orc:approval`) — none of which `autoRelay` (the walking-skeleton's
// fixed-topology fixture) knows about. Where a real orchestrator would doc-read/doc-write and
// author, this writes the real artifact via `daemon.seedDoc` (never a fake capability), then
// relays exactly the completion the corresponding node type's own `handle` expects — including,
// for `rad-orc:plan_corrective`, the real re-explode `Expansion` computed via the same
// `parseMasterPlan`/`buildExecutionExpansion` pipeline `rad-orc:explosion` itself runs. Every other
// external actor (the phase loop `rad-orc:explosion` seeds once the plan is approved) delegates to
// `autoRelay`, except `rad-orc:code_review`: its review ids are minted dynamically by the
// decoration cadence, never known ahead of a fixed path the walking-skeleton fixtures can
// pre-stage, so this seeds each review's own default report before relaying.
import type { Expansion } from '@rad-orchestration/graph-engine';
import type { PlanAuditVerdict } from '@rad-orchestration/graph-node-types';
import {
  APPROVAL_DECIDED_TOKEN,
  CODE_REVIEW_REVIEWED_TOKEN,
  MASTER_PLAN_AUTHORED_TOKEN,
  PLAN_AUDIT_AUDITED_TOKEN,
  PLAN_CORRECTIVE_COMPLETED_TOKEN,
  buildExecutionExpansion,
  parseMasterPlan,
} from '@rad-orchestration/graph-node-types';
import type { BootedDaemon } from '../harness/boot.js';
import type { ExplicitEvent, StoppedActor } from '../harness/drive.js';
import { reviewReportDoc } from './phase-chain.js';
import { PLAN_SUBGRAPH_CADENCE, PLAN_SUBGRAPH_DOC_PATHS, PLAN_SUBGRAPH_IDS } from './plan-subgraph-seed.js';
import { autoRelay } from './relay.js';

export interface PlanningRelayOptions {
  /**
   * The master-plan doc content `rad-orc:master_plan` authors each time it stops, one entry per
   * authoring cycle in order — a parse-fail retry re-authors, so a recovery/halt scenario supplies
   * more than one. Throws if `rad-orc:master_plan` stops more times than this stages for.
   */
  readonly masterPlanDocs: readonly string[];
  /** `rad-orc:plan_audit`'s own verdict; defaults to `'approved'`. */
  readonly auditVerdict?: PlanAuditVerdict;
  /**
   * Required when `auditVerdict === 'issues_found'` — the corrected master-plan doc
   * `rad-orc:plan_corrective` inline-edits to, from which its own re-explode `Expansion` is
   * computed the same way `rad-orc:explosion` itself computes one.
   */
  readonly correctedMasterPlanDoc?: string;
}

function planAuditReportDoc(verdict: PlanAuditVerdict): string {
  return reviewReportDoc(verdict, 'none');
}

/**
 * Builds a `driveToQuiescence` `resolve` callback covering the plan subgraph's own four
 * external-actor node types, falling back to `autoRelay` (extended for `rad-orc:code_review`'s own
 * dynamically-minted report) for the phase loop `rad-orc:explosion` seeds once the plan is approved.
 */
export function createPlanningRelay(daemon: BootedDaemon, options: PlanningRelayOptions): (actor: StoppedActor) => ExplicitEvent | undefined {
  let masterPlanCalls = 0;

  return function resolve(actor: StoppedActor): ExplicitEvent | undefined {
    switch (actor.type) {
      case 'rad-orc:master_plan': {
        const doc = options.masterPlanDocs[masterPlanCalls];
        if (doc === undefined) {
          throw new Error(
            `planning relay: 'rad-orc:master_plan' authored a ${masterPlanCalls + 1}th time — only ${options.masterPlanDocs.length} doc(s) staged`,
          );
        }
        masterPlanCalls += 1;
        daemon.seedDoc(PLAN_SUBGRAPH_DOC_PATHS.masterPlanDocPath, doc);
        return {
          event: MASTER_PLAN_AUTHORED_TOKEN,
          payload: { outcome: 'ok', data: { docPath: PLAN_SUBGRAPH_DOC_PATHS.masterPlanDocPath } },
        };
      }

      case 'rad-orc:plan_audit': {
        const verdict = options.auditVerdict ?? 'approved';
        daemon.seedDoc(PLAN_SUBGRAPH_DOC_PATHS.reviewReportPath, planAuditReportDoc(verdict));
        const data: Record<string, unknown> = { verdict };
        if (verdict === 'issues_found') {
          Object.assign(data, {
            correctiveIndex: 1,
            reviewReportPath: PLAN_SUBGRAPH_DOC_PATHS.reviewReportPath,
            masterPlanDoc: PLAN_SUBGRAPH_DOC_PATHS.masterPlanDocPath,
            planApprovalNodeId: PLAN_SUBGRAPH_IDS.planApproval,
          });
        }
        return { event: PLAN_AUDIT_AUDITED_TOKEN, payload: { outcome: 'ok', data } };
      }

      case 'rad-orc:plan_corrective': {
        const corrected = options.correctedMasterPlanDoc;
        if (!corrected) {
          throw new Error("planning relay: 'rad-orc:plan_corrective' stopped with no correctedMasterPlanDoc staged");
        }
        daemon.seedDoc(PLAN_SUBGRAPH_DOC_PATHS.masterPlanDocPath, corrected);
        const parsed = parseMasterPlan(corrected);
        if (parsed.outcome !== 'ok') {
          throw new Error(`planning relay: correctedMasterPlanDoc failed to parse: ${parsed.data.message}`);
        }
        const expansion: Expansion = buildExecutionExpansion(parsed.data, PLAN_SUBGRAPH_CADENCE, PLAN_SUBGRAPH_IDS.planApproval);
        return {
          event: PLAN_CORRECTIVE_COMPLETED_TOKEN,
          payload: { outcome: 'ok', data: { explosionNodeId: PLAN_SUBGRAPH_IDS.explosion, expansion } },
        };
      }

      case 'rad-orc:approval': {
        const level = actor.id === PLAN_SUBGRAPH_IDS.planApproval ? 'plan' : 'final';
        return { event: APPROVAL_DECIDED_TOKEN, payload: { outcome: 'ok', data: { decision: 'granted', level } } };
      }

      case 'rad-orc:code_review': {
        daemon.seedDoc(`reviews/${actor.id}.md`, reviewReportDoc('approved', 'none'));
        return { event: CODE_REVIEW_REVIEWED_TOKEN, payload: { outcome: 'ok', data: {} } };
      }

      default:
        return autoRelay(actor);
    }
  };
}
