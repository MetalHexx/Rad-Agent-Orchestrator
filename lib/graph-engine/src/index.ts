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
export { ROOT_NODE_ID, ROOT_TRAITS, createRootNode } from './model/root.js';

export type { Result, EngineError, EngineErrorCode } from './result.js';

export type { ProjectScope, StateStore } from './store/state-store.js';
export { InMemoryStateStore } from './store/in-memory-store.js';

export { frontier, remaining, deriveContainerStatus } from './derive/readiness.js';

export type { GraphSnapshot, MutationSpec, OrderContradiction } from './derive/invariants.js';
export { findOrderContradictions } from './derive/invariants.js';
export type { PreviewCone } from './derive/dry-run.js';
export { validate, preview } from './derive/dry-run.js';

export type { PrimitiveContext } from './primitives/primitive.js';
export type {
  AddNodeOptions,
  ChildRemovalStrategy,
  DependentRemovalStrategy,
  RemoveNodeStrategy,
} from './primitives/crud.js';
export {
  add_node,
  remove_node,
  add_dependency,
  remove_dependency,
  move_node,
  set_order,
} from './primitives/crud.js';
export { toggle, resume } from './primitives/lifecycle.js';
export type { NodeSpec, Expansion } from './primitives/expand.js';
export { expand } from './primitives/expand.js';
export type { EventHandler } from './primitives/apply-event.js';
export { apply_event } from './primitives/apply-event.js';
