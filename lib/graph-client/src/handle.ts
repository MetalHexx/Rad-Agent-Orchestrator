import { request } from './transport.js';
import { GraphClientError } from './errors.js';
import type { GraphClientConfig } from './client.js';
import type {
  DagSnapshot,
  EventToken,
  NextActionEnvelope,
  NodeId,
  NodeView,
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
}
