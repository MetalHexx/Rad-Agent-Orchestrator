import { ProjectHandle } from './handle.js';

export interface GraphClientConfig {
  /** e.g. 'http://127.0.0.1:53187' — a RUNNING service; the client never starts one. */
  readonly baseUrl: string;
  /** Injection seam for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Per-request timeout; defaults to 30s. */
  readonly timeoutMs?: number;
}

/**
 * Binds to a running graph-service instance. The client knows the service, not any one
 * project — it holds no project state; call {@link GraphClient.project} for a fresh,
 * independently-usable handle scoped to a project id.
 */
export class GraphClient {
  private readonly config: GraphClientConfig;

  constructor(config: GraphClientConfig) {
    this.config = config;
  }

  /** Binds scope to `projectId`. Returns a fresh handle each call (D15 "separate shells"). */
  project(projectId: string): ProjectHandle {
    return new ProjectHandle(projectId, this.config);
  }
}
