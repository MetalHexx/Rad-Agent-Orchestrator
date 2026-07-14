// Facade-only seam: `@rad-orchestration/graph-client` is consumed exclusively through this
// barrel — nothing outside this package reaches into `src/*` by path.

export { GraphClient } from './client.js';
export type { GraphClientConfig } from './client.js';

export { ProjectHandle } from './handle.js';
export type { SubmitEventInput } from './handle.js';

export { GraphClientError, GRAPH_CLIENT_ERROR_CODES } from './errors.js';
export type { GraphClientErrorCode } from './errors.js';

export { NODE_STATUSES, EXECUTORS } from './types.js';
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
} from './types.js';
