// graph-service/tests/fixtures/plan-relay.ts
//
// The orchestrator-role `driveToQuiescence` `resolve` callback for the plan subgraph's own
// external-actor node types (`rad-orc:master_plan`/the plan-level `rad-orc:approval`) — neither of
// which `autoRelay` (the walking-skeleton's fixed-topology fixture) knows about. Where a real
// orchestrator would doc-read/doc-write and author, this writes the real artifact via
// `daemon.seedDoc` (never a fake capability), then relays exactly the completion the corresponding
// node type's own `handle` expects. Every other external actor (the phase loop `rad-orc:explosion`
// seeds once the plan is approved) delegates to `autoRelay`, except `rad-orc:code_review`: its
// review ids are minted dynamically by the decoration cadence, never known ahead of a fixed path
// the walking-skeleton fixtures can pre-stage, so this seeds each review's own default report
// before relaying.
import { APPROVAL_DECIDED_TOKEN, CODE_REVIEW_REVIEWED_TOKEN, MASTER_PLAN_AUTHORED_TOKEN } from '@rad-orchestration/graph-node-types';
import type { BootedDaemon } from '../harness/boot.js';
import type { ExplicitEvent, StoppedActor } from '../harness/drive.js';
import { reviewReportDoc } from './phase-chain.js';
import { PLAN_SUBGRAPH_DOC_PATHS, PLAN_SUBGRAPH_IDS } from './plan-subgraph-seed.js';
import { autoRelay } from './relay.js';

export interface PlanningRelayOptions {
  /**
   * The master-plan doc content `rad-orc:master_plan` authors each time it stops, one entry per
   * authoring cycle in order — a parse-fail retry, or a plan-level rejection, re-authors, so a
   * recovery/halt/rejection scenario supplies more than one. Throws if `rad-orc:master_plan` stops
   * more times than this stages for.
   */
  readonly masterPlanDocs: readonly string[];
}

/**
 * Builds a `driveToQuiescence` `resolve` callback covering the plan subgraph's own two
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
