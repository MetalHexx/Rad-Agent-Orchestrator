// Facade-only seam: `@rad-orchestration/graph-node-types` is consumed exclusively through this
// barrel — nothing outside this package imports internals by path.
export { ENGINE_SCHEMA_VERSION } from '@rad-orchestration/graph-engine';

export type { EventTokenIncoherence } from './event-tokens.js';
export {
  EVENT_TOKENS,
  BUILT_IN_ROUTED_OUTCOMES,
  findEventTokenIncoherence,
  assertEventTokenCoherence,
} from './event-tokens.js';

import type { NodeTypeDefinition } from '@rad-orchestration/graph-engine';

// ── rad-orc:* built-ins ──────────────────────────────────────────────────────────
// The structural container, the pre-execution planning spine, and the execution/review node types —
// the nine `rad-orc:*` node types (phase, master_plan, plan_audit, explosion, approval, task,
// code_review, corrective, pr), registered under the same `NodeTypeRegistry` as any custom type.

export { PHASE_NODE_TYPE, PHASE_DATA_SCHEMA } from './rad-orc/phase.js';

export type { MasterPlanAuthoredData } from './rad-orc/master-plan.js';
export {
  MASTER_PLAN_NODE_TYPE,
  MASTER_PLAN_DATA_SCHEMA,
  MASTER_PLAN_AUTHORED_TOKEN,
} from './rad-orc/master-plan.js';

export type { PlanAuditAuditedData } from './rad-orc/plan-audit.js';
export {
  PLAN_AUDIT_NODE_TYPE,
  PLAN_AUDIT_DATA_SCHEMA,
  PLAN_AUDIT_AUDITED_TOKEN,
} from './rad-orc/plan-audit.js';

export type {
  ApprovalDecidedData,
  ApprovalDecision,
  ApprovalLevel,
} from './rad-orc/approval.js';
export {
  APPROVAL_NODE_TYPE,
  APPROVAL_DATA_SCHEMA,
  APPROVAL_LEVELS,
  APPROVAL_DECISIONS,
  APPROVAL_DECIDED_TOKEN,
} from './rad-orc/approval.js';

export type { TaskCompletedData } from './rad-orc/task.js';
export {
  TASK_NODE_TYPE,
  TASK_DATA_SCHEMA,
  TASK_COMPLETED_TOKEN,
} from './rad-orc/task.js';

export type {
  CodeReviewLevel,
  CodeReviewReviewedData,
  CodeReviewSpawnPayload,
  FinalCodeReviewSpawnPayload,
  FinalReviewRepo,
  PhaseCodeReviewSpawnPayload,
  PhaseReviewRepo,
  ReviewVerdict,
  Severity,
  TaskCodeReviewSpawnPayload,
  TaskReviewRepo,
} from './rad-orc/code-review.js';
export {
  CODE_REVIEW_NODE_TYPE,
  CODE_REVIEW_DATA_SCHEMA,
  CODE_REVIEW_LEVELS,
  CODE_REVIEW_REVIEWED_TOKEN,
  REVIEW_VERDICTS,
  SEVERITIES,
} from './rad-orc/code-review.js';

export { CORRECTIVE_NODE_TYPE, CORRECTIVE_DATA_SCHEMA } from './rad-orc/corrective.js';

export type { PrCreatedData, PrRepoRef, PrRepoResult } from './rad-orc/pr.js';
export {
  PR_NODE_TYPE,
  PR_DATA_SCHEMA,
  PR_CREATED_TOKEN,
} from './rad-orc/pr.js';

export type {
  DecorationCadence,
  ExplosionNodeTypeOptions,
  ExplosionParseFailureData,
  ExplosionParseSuccessData,
  MasterPlanParseFailure,
  ParsedMasterPlan,
  ParsedPhase,
  ParsedTask,
} from './rad-orc/explosion.js';
export {
  DEFAULT_PARSE_RETRY_LIMIT,
  EXPLOSION_DATA_SCHEMA,
  EXPLOSION_NODE_TYPE,
  EXPLOSION_PARSED_TOKEN,
  EXPLOSION_PARSE_FAILED_TOKEN,
  MASTER_PLAN_PARSER_CAPABILITY,
  buildExecutionExpansion,
  createExplosionNodeType,
  parseMasterPlan,
} from './rad-orc/explosion.js';

import { PHASE_NODE_TYPE } from './rad-orc/phase.js';
import { MASTER_PLAN_NODE_TYPE } from './rad-orc/master-plan.js';
import { PLAN_AUDIT_NODE_TYPE } from './rad-orc/plan-audit.js';
import { EXPLOSION_NODE_TYPE } from './rad-orc/explosion.js';
import { APPROVAL_NODE_TYPE } from './rad-orc/approval.js';
import { TASK_NODE_TYPE } from './rad-orc/task.js';
import { CODE_REVIEW_NODE_TYPE } from './rad-orc/code-review.js';
import { CORRECTIVE_NODE_TYPE } from './rad-orc/corrective.js';
import { PR_NODE_TYPE } from './rad-orc/pr.js';

/** Every `rad-orc:*` built-in this package ships, ready to hand to `createNodeTypeRegistry` as its `builtins` argument. */
export const BUILT_IN_NODE_TYPES: readonly NodeTypeDefinition[] = [
  PHASE_NODE_TYPE,
  MASTER_PLAN_NODE_TYPE,
  PLAN_AUDIT_NODE_TYPE,
  EXPLOSION_NODE_TYPE,
  APPROVAL_NODE_TYPE,
  TASK_NODE_TYPE,
  CODE_REVIEW_NODE_TYPE,
  CORRECTIVE_NODE_TYPE,
  PR_NODE_TYPE,
];
