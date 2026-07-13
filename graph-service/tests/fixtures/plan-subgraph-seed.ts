// graph-service/tests/fixtures/plan-subgraph-seed.ts
//
// Stamps the plan subgraph — `rad-orc:master_plan` -> `rad-orc:explosion` -> `rad-orc:plan_audit`
// -> `rad-orc:approval` (`level: 'plan'`) — the root-level spine that runs ahead of the phase loop
// `explosion`'s own `buildExecutionExpansion` materializes at runtime (gated behind the seeded
// plan-approval node, never expanded by this fixture itself: that batch is `explosion`'s `handle`
// reacting to a real parse, not a static seed). Node types are named by `namespace:name` string
// literals only — this fixture never imports a `NodeTypeDefinition`, so swapping the registry's
// contents changes what materializes with no edit here (registry-resolution, not a hardcoded type
// import). Reused by the functional suite (P04-T02) and any future template loader alike.
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import type { DecorationCadence } from '@rad-orchestration/graph-node-types';
import type { SeedStep } from '../harness/drive.js';

export const PLAN_SUBGRAPH_IDS = {
  masterPlan: 'master-plan-1',
  explosion: 'explosion-1',
  planAudit: 'plan-audit-1',
  planApproval: 'plan-approval-1',
} as const;

/** The doc paths `master_plan`/`plan_audit` are seeded to agree on — the same convention `explosion-runner.test.ts` pins for its own master-plan path. */
export const PLAN_SUBGRAPH_DOC_PATHS = {
  requirementsDocPath: 'docs/requirements.md',
  masterPlanDocPath: 'docs/master-plan/master-plan.md',
  reviewReportPath: `reviews/${PLAN_SUBGRAPH_IDS.planAudit}.md`,
} as const;

/** The cadence `explosion`'s seeded `data.cadence` carries — mirrors the richest pre-DAG review tier (per-task + per-phase review, plus a final review/PR/approval spine). */
export const PLAN_SUBGRAPH_CADENCE: DecorationCadence = {
  perTask: ['rad-orc:code_review'],
  perPhase: ['rad-orc:code_review'],
  spine: ['rad-orc:code_review', 'rad-orc:pr', 'rad-orc:approval'],
};

/** A template-shaped master-plan doc `parseMasterPlan` accepts: two phases, each with a `Doc:` line, exit criteria, and tasks. */
export const WELL_FORMED_MASTER_PLAN_DOC = `# Master Plan

## Phase 1: Foundation
Doc: docs/phases/phase-1.md
Exit Criteria:
- Foundations laid

### Task 1: Scaffold the module

## Phase 2: Delivery
Doc: docs/phases/phase-2.md
Exit Criteria:
- Delivery shipped

### Task 1: Ship it
### Task 2: Write the docs
`;

/** Missing the required `Doc:` line under Phase 1 — `parseMasterPlan` rejects this at end-of-phase. */
export const MALFORMED_MASTER_PLAN_DOC = `## Phase 1: Foundation
Exit Criteria:
- Foundations laid

### Task 1: Scaffold
`;

/**
 * The four-node root-level spine, in frontier order: `master_plan` (no dependency — the seeded
 * frontier starts here), `explosion` (depends on `master_plan`), `plan_audit` (depends on
 * `explosion`), and the plan-level `approval` (depends on `plan_audit`). The phase loop `explosion`
 * decorates at runtime is never seeded here — only the spine its `buildExecutionExpansion` gates
 * phases behind (`planApprovalNodeId`) exists ahead of time.
 */
export function planSubgraphSeedSteps(): readonly SeedStep[] {
  return [
    {
      primitive: 'add_node',
      id: PLAN_SUBGRAPH_IDS.masterPlan,
      type: 'rad-orc:master_plan',
      parent: ROOT_NODE_ID,
      order: 0,
      data: { requirementsDocPath: PLAN_SUBGRAPH_DOC_PATHS.requirementsDocPath },
    },
    {
      primitive: 'add_node',
      id: PLAN_SUBGRAPH_IDS.explosion,
      type: 'rad-orc:explosion',
      parent: ROOT_NODE_ID,
      order: 1,
      dependsOn: [PLAN_SUBGRAPH_IDS.masterPlan],
      data: { cadence: PLAN_SUBGRAPH_CADENCE },
    },
    {
      primitive: 'add_node',
      id: PLAN_SUBGRAPH_IDS.planAudit,
      type: 'rad-orc:plan_audit',
      parent: ROOT_NODE_ID,
      order: 2,
      dependsOn: [PLAN_SUBGRAPH_IDS.explosion],
      data: {
        requirementsDocPath: PLAN_SUBGRAPH_DOC_PATHS.requirementsDocPath,
        masterPlanDocPath: PLAN_SUBGRAPH_DOC_PATHS.masterPlanDocPath,
        reviewReportPath: PLAN_SUBGRAPH_DOC_PATHS.reviewReportPath,
      },
    },
    {
      primitive: 'add_node',
      id: PLAN_SUBGRAPH_IDS.planApproval,
      type: 'rad-orc:approval',
      parent: ROOT_NODE_ID,
      order: 3,
      dependsOn: [PLAN_SUBGRAPH_IDS.planAudit],
      data: { level: 'plan' },
    },
  ];
}
