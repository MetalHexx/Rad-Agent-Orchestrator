// Facade-only seam: `@rad-orchestration/graph-client` is consumed exclusively through this
// barrel — nothing outside this package reaches into `src/*` by path.

export { GraphClient } from './client.js';
export type { GraphClientConfig } from './client.js';

export { ProjectHandle } from './handle.js';
export type { SubmitEventInput } from './handle.js';

export type { Subscription } from './sse.js';

export { GraphClientError, GRAPH_CLIENT_ERROR_CODES } from './errors.js';
export type { GraphClientErrorCode } from './errors.js';

export { NODE_STATUSES, EXECUTORS, SHARED_MUTATION_KINDS } from './types.js';
export type {
  NodeStatus,
  Executor,
  NodeId,
  NodeTypeName,
  EventToken,
  EdgeKind,
  DagNode,
  DagEdge,
  Presentation,
  NodeView,
  ChangeOp,
  NodeChange,
  EdgeChange,
  ChangeDelta,
  DagSnapshot,
  NextActionEnvelope,
  DependentRemovalStrategy,
  ChildRemovalStrategy,
  RemoveNodeStrategy,
  Expansion,
  AddCorrectiveOptions,
  SharedMutationRequest,
  DryRunResult,
  SeedStep,
  SeedResult,
  StreamDelta,
} from './types.js';
