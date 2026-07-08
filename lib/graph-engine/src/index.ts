// Facade-only seam: `@rad-orchestration/graph-engine` is consumed exclusively through this
// barrel — nothing outside this package imports internals by path.
export const ENGINE_SCHEMA_VERSION = 'graph-engine/v0' as const;

export type { NodeId, DagNode } from './model/node.js';
export type { EdgeKind, DagEdge } from './model/edge.js';
export type { ChangeOp, NodeChange, EdgeChange, ChangeDelta } from './model/delta.js';
export type {
  NodeTypeName,
  NodeStatus,
  Trait,
  Executor,
  ReviewVerdict,
  Severity,
  CapabilityName,
  PrimitiveName,
  EventToken,
} from './model/vocab.js';
export {
  NODE_STATUSES,
  TRAITS,
  EXECUTORS,
  REVIEW_VERDICTS,
  SEVERITIES,
  CAPABILITY_NAMES,
  PRIMITIVE_NAMES,
  assertNever,
} from './model/vocab.js';
