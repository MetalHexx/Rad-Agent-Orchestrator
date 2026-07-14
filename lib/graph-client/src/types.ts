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

// ── Steering / mutation vocabulary (mirrored from graph-service/src/http/mutation-spec.ts) ──
// `removeNode`'s D16 strategy: the SDK never derives edge mutations itself, it just threads this
// straight through as `params.strategy` for the service to translate and own the invariants on.
export type DependentRemovalStrategy = 'heal' | 'cascade' | 'detach';
export type ChildRemovalStrategy = 'cascade' | 'promote';

export interface RemoveNodeStrategy {
  dependents: DependentRemovalStrategy;
  children?: ChildRemovalStrategy;
}

// Engine shapes the client relays opaquely: `expansion.specs`/`options` are never interpreted
// here, and `expand`'s registry is server-injected — the client never supplies one.
export interface Expansion {
  readonly specs: unknown[];
}

export type AddCorrectiveOptions = Readonly<Record<string, unknown>>;

/**
 * The one request shape `steer` and `dryRun` both build from — the six primitive kinds the
 * engine's mutation vocabulary covers. `steer` nests this as `params` (kind carried by
 * `primitive`); `dryRun` nests it as `mutation` (kind inline) — same vocabulary, two envelope
 * shapes.
 */
export type SharedMutationRequest =
  | { kind: 'add_dependency'; from: NodeId; to: NodeId }
  | { kind: 'remove_node'; nodeId: NodeId; strategy: RemoveNodeStrategy }
  | { kind: 'move_node'; nodeId: NodeId; newParent: NodeId }
  | { kind: 'expand'; node: NodeId; expansion: Expansion }
  | { kind: 'add_corrective'; review: NodeId; id: NodeId; type: NodeTypeName; options?: AddCorrectiveOptions }
  | { kind: 'reset'; node: NodeId; cascade: boolean };

/** The six kinds `SharedMutationRequest` covers. */
export const SHARED_MUTATION_KINDS = [
  'add_dependency',
  'remove_node',
  'move_node',
  'expand',
  'add_corrective',
  'reset',
] as const;

/**
 * `dryRun`'s read-only preview envelope. Both branches arrive `ok: true` on the wire — an invalid
 * mutation is a successful read reporting `valid: false`, not a thrown error. `preview` (the
 * cascade cone — `PreviewCone` | `AddCorrectivePreview` | `ResetPreview` on the service side) is
 * relayed opaquely; only a bad `kind` throws (`invalid_request`).
 */
export type DryRunResult =
  | { valid: true; preview: unknown }
  | { valid: false; reason: string; preview: null };

/** A `seed` template step — node-type-agnostic; the client relays steps and results without
 * interpreting node internals. */
export type SeedStep =
  | {
      primitive: 'add_node';
      id: NodeId;
      type: NodeTypeName;
      parent: NodeId;
      order?: number;
      data?: Readonly<Record<string, unknown>>;
      dependsOn?: NodeId[];
    }
  | { primitive: 'add_dependency'; from: NodeId; to: NodeId }
  | { primitive: 'expand'; node: NodeId; expansion: Expansion };

export interface SeedResult {
  nodesCreated: number;
  edgesCreated: number;
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
