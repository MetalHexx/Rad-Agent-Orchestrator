import { request } from './transport.js';
import { GraphClientError } from './errors.js';
import { subscribe as subscribeToStream } from './sse.js';
import type { Subscription } from './sse.js';
import type { GraphClientConfig } from './client.js';
import type {
  AddCorrectiveOptions,
  ChangeDelta,
  DagSnapshot,
  DryRunResult,
  EventToken,
  Expansion,
  NextActionEnvelope,
  NodeId,
  NodeTypeName,
  NodeView,
  RemoveNodeStrategy,
  SeedResult,
  SeedStep,
  SharedMutationRequest,
  StreamDelta,
} from './types.js';

// The engine's ROOT_NODE_ID: the project root node's *id* (not its *type*, `'system:root'`).
const PROJECT_ROOT_NODE_ID = 'root';

export interface SubmitEventInput {
  node: NodeId;
  event?: EventToken;
  payload?: { outcome: 'ok' | 'error'; data?: Readonly<Record<string, unknown>>; route?: string };
}

/**
 * Scopes every call to one project. Carries `projectId` + the client config and no other shared
 * mutable state, so concurrent handles are safe to use independently — D15 "separate shells".
 */
export class ProjectHandle {
  constructor(
    private readonly projectId: string,
    private readonly config: GraphClientConfig,
  ) {}

  /** POST /engine-graph/submit-event — drives the run from `input.node`'s current state. */
  async submitEvent(input: SubmitEventInput): Promise<NextActionEnvelope> {
    const hasEvent = input.event !== undefined;
    const hasPayload = input.payload !== undefined;
    if (hasEvent !== hasPayload) {
      throw new GraphClientError(
        'invalid_request',
        '`event` and `payload` must be supplied together or both omitted',
        null,
      );
    }
    return request<NextActionEnvelope>(this.config, {
      method: 'POST',
      path: '/engine-graph/submit-event',
      body: {
        project: this.projectId,
        node: input.node,
        event: input.event,
        payload: input.payload,
      },
    });
  }

  /** GET /engine-graph/dag — the root-scoped snapshot. */
  async dag(): Promise<DagSnapshot> {
    return request<DagSnapshot>(this.config, {
      method: 'GET',
      path: '/engine-graph/dag',
      query: { project: this.projectId },
    });
  }

  /** GET /engine-graph/frontier — `context` defaults to the project root when omitted. */
  async frontier(context?: string): Promise<NodeView[]> {
    return request<NodeView[]>(this.config, {
      method: 'GET',
      path: '/engine-graph/frontier',
      query: { project: this.projectId, context: context ?? PROJECT_ROOT_NODE_ID },
    });
  }

  /** GET /engine-graph/node. */
  async node(id: NodeId): Promise<NodeView> {
    return request<NodeView>(this.config, {
      method: 'GET',
      path: '/engine-graph/node',
      query: { project: this.projectId, node: id },
    });
  }

  /** Steer: adds a `depends_on` edge from `from` to `to`. */
  async addDependency(from: NodeId, to: NodeId): Promise<ChangeDelta> {
    return this.steer('add_dependency', { from, to });
  }

  /** Steer: removes `nodeId` (D16) — `strategy.dependents` is required, `strategy.children`
   * optional; passed through untouched, the service owns the invariants. */
  async removeNode(nodeId: NodeId, strategy: RemoveNodeStrategy): Promise<ChangeDelta> {
    return this.steer('remove_node', { nodeId, strategy });
  }

  /** Steer: re-parents `nodeId` under `newParent`. */
  async moveNode(nodeId: NodeId, newParent: NodeId): Promise<ChangeDelta> {
    return this.steer('move_node', { nodeId, newParent });
  }

  /** Steer: expands `node` per `expansion` — the server injects its own type registry. */
  async expand(node: NodeId, expansion: Expansion): Promise<ChangeDelta> {
    return this.steer('expand', { node, expansion });
  }

  /** Steer: adds a corrective node `id` of `type` under review node `review`. */
  async addCorrective(
    review: NodeId,
    id: NodeId,
    type: NodeTypeName,
    options?: AddCorrectiveOptions,
  ): Promise<ChangeDelta> {
    return this.steer('add_corrective', { review, id, type, options });
  }

  /** Steer: resets `node`, cascading to its descendants when `cascade` is true. */
  async reset(node: NodeId, cascade: boolean): Promise<ChangeDelta> {
    return this.steer('reset', { node, cascade });
  }

  /** POST /engine-graph/steer — the six typed methods above all funnel through here; `kind` is
   * carried by `primitive`, `params` is the shared-mutation shape minus `kind`. */
  private async steer(
    primitive: SharedMutationRequest['kind'],
    params: Readonly<Record<string, unknown>>,
  ): Promise<ChangeDelta> {
    return request<ChangeDelta>(this.config, {
      method: 'POST',
      path: '/engine-graph/steer',
      body: { project: this.projectId, primitive, params },
    });
  }

  /**
   * POST /engine-graph/dry-run — a read that validates and previews `mutation`'s cascade cone
   * without changing anything. Nests the mutation as `mutation` (kind inline) — the opposite
   * shape from `steer`'s `{ primitive, params }`. A valid-but-rejected mutation resolves with
   * `{ valid: false, reason, preview: null }` rather than throwing; only a bad `kind` throws
   * (`invalid_request`).
   */
  async dryRun(mutation: SharedMutationRequest): Promise<DryRunResult> {
    return request<DryRunResult>(this.config, {
      method: 'POST',
      path: '/engine-graph/dry-run',
      body: { project: this.projectId, mutation },
    });
  }

  /** POST /engine-graph/seed — replays `steps` to bring a project's DAG into being from a
   * compiled template. Node-type-agnostic: relays the steps and result, interprets no node
   * internals. */
  async seed(steps: SeedStep[]): Promise<SeedResult> {
    return request<SeedResult>(this.config, {
      method: 'POST',
      path: '/engine-graph/seed',
      body: { project: this.projectId, seed: { steps } },
    });
  }

  /** GET /engine-graph/stream?project=<projectId> — opens a live subscription for this
   * project's changes; `onDelta` fires per committed change, `close()` on the returned
   * `Subscription` stops the stream and cancels any pending reconnect. */
  subscribe(onDelta: (delta: StreamDelta) => void, opts?: { onError?: (err: GraphClientError) => void }): Subscription {
    return subscribeToStream(this.config, this.projectId, onDelta, opts);
  }
}
