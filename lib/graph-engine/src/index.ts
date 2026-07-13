// Facade-only seam: `@rad-orchestration/graph-engine` is consumed exclusively through this
// barrel — nothing outside this package imports internals by path.
export const ENGINE_SCHEMA_VERSION = 'graph-engine/v0' as const;

import type { NodeId } from './model/node.js';
import type { NodeTypeName } from './model/vocab.js';
import type { ChangeDelta } from './model/delta.js';
import type { Result } from './result.js';
import type { ProjectScope, StateStore } from './store/state-store.js';
import type { NodeTypeRegistry } from './node-type/registry.js';
import type { AddNodeOptions } from './primitives/crud.js';
import { add_node as addNode } from './primitives/crud.js';
import type { Expansion } from './primitives/expand.js';
import { expand as expandBatch } from './primitives/expand.js';

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
export type { PreviewCone, AddCorrectivePreview, ResetPreview } from './derive/dry-run.js';
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
export type { AddCorrectiveOptions } from './primitives/corrective.js';
export { add_corrective } from './primitives/corrective.js';
export { reset } from './primitives/reset.js';

export type { NodeTypeRegistry } from './node-type/registry.js';
export { RESERVED_NODE_TYPE_PREFIX, createNodeTypeRegistry } from './node-type/registry.js';

/** The two mutation primitives {@link createEngine} binds against an injected registry + store. */
export interface Engine {
  readonly add_node: (
    scope: ProjectScope,
    id: NodeId,
    type: NodeTypeName,
    parent: NodeId,
    options?: AddNodeOptions,
  ) => Result<ChangeDelta>;
  readonly expand: (scope: ProjectScope, node: NodeId, expansion: Expansion) => Result<ChangeDelta>;
}

/**
 * The engine's composition point: binds `store` and `registry` once, producing `add_node`/`expand`
 * bound to both, so every insert resolves its `type` through the same injected registry — a caller
 * only ever supplies the per-call `scope` and the primitive's own arguments, never a store/registry
 * pair it has to source from somewhere global.
 */
export function createEngine(store: StateStore, registry: NodeTypeRegistry): Engine {
  return {
    add_node: (scope, id, type, parent, options) => addNode({ store, scope }, registry, id, type, parent, options),
    expand: (scope, node, expansion) => expandBatch({ store, scope }, registry, node, expansion),
  };
}

export type {
  ActContext,
  ActResult,
  AgentSpawnRequest,
  DataChange,
  DataFieldKind,
  DataFieldLevel,
  DataFieldSpec,
  DataSchema,
  Envelope,
  EnvelopeOutcome,
  HandleResult,
  NodeEvent,
  NodeTypeDefinition,
  Presentation,
  ReviewSpawnRequest,
  RoutingRequest,
} from './node-type/definition.js';
export { DATA_FIELD_KINDS, DATA_FIELD_LEVELS, ENVELOPE_OUTCOMES } from './node-type/definition.js';

export type { DispatchRequest } from './driver/contract.js';
export { readFrontier, isQuiescent, engage } from './driver/contract.js';
export type { ChangeListener, Unsubscribe, ChangeStream } from './driver/change-stream.js';
export { withChangeStream } from './driver/change-stream.js';

export type {
  CodeBehindPort,
  DocReadPort,
  DocReadRequest,
  DocWritePort,
  DocWriteRequest,
  DocWriteResult,
  GitFacts,
  GitFactsPort,
  GitFactsRequest,
  IdempotentCallContext,
  RequestHumanPort,
  RequestHumanRequest,
  RequestHumanResult,
  RunCommandPort,
  RunCommandRequest,
  RunCommandResult,
  SpawnAgentPort,
  SpawnAgentRequest,
  SpawnAgentResult,
} from './node-type/capabilities.js';
