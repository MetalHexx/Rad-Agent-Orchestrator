// Client-owned wire mirror of the graph-service's `/engine-graph` surface. Hand-authored, not
// imported: the service defines the wire shapes; this package duplicates the subset it consumes
// so the shared source of truth stays the running service's behavior (enforced by tests), not a
// shared symbol (R8 / D25).

export const NODE_STATUSES = ['not_started', 'in_progress', 'done', 'blocked', 'failed'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const EXECUTORS = ['spawn-sub-agent', 'orchestrator-inline', 'request-human', 'noop'] as const;
export type Executor = (typeof EXECUTORS)[number];

export type NodeId = string;
export type NodeTypeName = `${string}:${string}`;
export type EventToken = `${NodeTypeName}.${string}`;
export type EdgeKind = 'depends_on';

export interface DagNode {
  id: NodeId;
  type: NodeTypeName;
  status: NodeStatus;
  parent: NodeId | null;
  order: number;
  derivedFrom: NodeId | null;
  disabled?: boolean;
  budgetAnchor?: NodeId | null;
  data: Readonly<Record<string, unknown>>;
}

export interface DagEdge {
  from: NodeId;
  to: NodeId;
  kind: EdgeKind;
}

export interface Presentation {
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly color?: string;
}

// service-LOCAL & unexported there — the client owns this shape.
export interface NodeView extends DagNode {
  readonly presentation: Presentation;
}

export type ChangeOp = 'created' | 'updated' | 'removed';

export interface NodeChange {
  op: ChangeOp;
  before: DagNode | null;
  after: DagNode | null;
}

export interface EdgeChange {
  op: ChangeOp;
  before: DagEdge | null;
  after: DagEdge | null;
}

export interface ChangeDelta {
  primitive: string;
  params: Readonly<Record<string, unknown>>;
  nodeChanges: NodeChange[];
  edgeChanges: EdgeChange[];
}

export interface DagSnapshot {
  nodes: NodeView[];
  edges: DagEdge[];
  frontier: NodeView[];
  status: NodeStatus;
}

// service-LOCAL & unexported there — the client owns this shape.
export interface NextActionEnvelope {
  readonly action: NodeTypeName | null;
  readonly node: NodeId | null;
  readonly executor: Executor | null;
  readonly instructions: string | null;
  readonly context: Readonly<Record<string, unknown>> | null;
  readonly completion_event: EventToken | null;
  readonly delta: ChangeDelta;
  readonly frontier: readonly NodeView[];
}
