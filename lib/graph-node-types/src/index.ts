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
// The structural container and the pre-execution planning spine — the first four `rad-orc:*`
// node types, registered under the same `NodeTypeRegistry` as any custom type.

export { PHASE_NODE_TYPE, PHASE_DATA_SCHEMA } from './rad-orc/phase.js';

export type { MasterPlanAuthoredData } from './rad-orc/master-plan.js';
export {
  MASTER_PLAN_NODE_TYPE,
  MASTER_PLAN_DATA_SCHEMA,
  MASTER_PLAN_AUTHORED_TOKEN,
} from './rad-orc/master-plan.js';

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
import { EXPLOSION_NODE_TYPE } from './rad-orc/explosion.js';
import { APPROVAL_NODE_TYPE } from './rad-orc/approval.js';

/** Every `rad-orc:*` built-in this package ships, ready to hand to `createNodeTypeRegistry` as its `builtins` argument. */
export const BUILT_IN_NODE_TYPES: readonly NodeTypeDefinition[] = [
  PHASE_NODE_TYPE,
  MASTER_PLAN_NODE_TYPE,
  EXPLOSION_NODE_TYPE,
  APPROVAL_NODE_TYPE,
];
