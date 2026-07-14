// lib/graph-client/src/sse.ts — the streaming half of the transport: opens
// `GET /engine-graph/stream?project=<id>`, parses the SSE frames the service emits
// (graph-service/src/http/streams.ts), and reconnects on a dropped stream. Deliberately basic
// (It. 8 owns event filtering, backpressure, multiplexing and reconnect-policy tuning): a fixed
// retry delay, forever, until `close()`. The service's stream does not honor `Last-Event-ID` and
// does not replay by `seq` — a reconnect only forwards changes committed after it reopens, so
// this module carries no resume/replay logic.
import { GraphClientError } from './errors.js';
import { isAbortError, tryParseFailureEnvelope } from './transport.js';
import type { GraphClientConfig } from './client.js';
import type { NodeChange, EdgeChange, StreamDelta } from './types.js';

/** A disposable handle to a live subscription. */
export interface Subscription {
  /** Stops the stream reader and cancels any pending reconnect. Idempotent. */
  close(): void;
}

const RECONNECT_DELAY_MS = 1_000;

// The wire shape `streams.ts` writes verbatim from `SqliteStateStore`'s change-log row —
// snake_cased, unlike the client's camelCase `StreamDelta`.
interface WireChangeLogRow {
  seq: number;
  project_id: string;
  ts: string;
  actor: string | null;
  primitive: string;
  params: Readonly<Record<string, unknown>>;
  node_changes: readonly NodeChange[];
  edge_changes: readonly EdgeChange[];
}

function toStreamDelta(row: WireChangeLogRow): StreamDelta {
  return {
    seq: row.seq,
    projectId: row.project_id,
    ts: row.ts,
    actor: row.actor,
    primitive: row.primitive,
    params: row.params,
    nodeChanges: row.node_changes,
    edgeChanges: row.edge_changes,
  };
}

interface SseFrame {
  readonly event: string;
  readonly data: string;
}

/** Parses one `\n`-joined SSE frame (the text between two `\n\n` separators) into its
 * `event`/`data` fields — mirrors `graph-service/tests/harness/sse.ts`'s parser. */
function parseSseFrame(raw: string): SseFrame | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

function buildStreamUrl(baseUrl: string, projectId: string): string {
  const url = new URL('/engine-graph/stream', baseUrl);
  url.searchParams.set('project', projectId);
  return url.toString();
}

function toGraphClientError(err: unknown, url: string): GraphClientError {
  if (err instanceof GraphClientError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new GraphClientError('network_error', `Stream at ${url} failed: ${message}`, null);
}

/**
 * Opens `GET /engine-graph/stream?project=<projectId>`, invoking `onDelta` with each parsed
 * `change` frame and reconnecting (fixed delay, unbounded attempts) on a dropped or errored
 * stream. `opts.onError` — when supplied — is reported on every failed open or read; the
 * subscription itself never throws. Returns a `Subscription`; `close()` stops the reader and
 * cancels any pending reconnect.
 */
export function subscribe(
  config: GraphClientConfig,
  projectId: string,
  onDelta: (delta: StreamDelta) => void,
  opts?: { onError?: (err: GraphClientError) => void },
): Subscription {
  const doFetch = config.fetch ?? fetch;
  const url = buildStreamUrl(config.baseUrl, projectId);

  let closed = false;
  let controller: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function reportError(err: unknown): void {
    opts?.onError?.(toGraphClientError(err, url));
  }

  async function runOnce(): Promise<void> {
    controller = new AbortController();
    let response: Response;
    try {
      response = await doFetch(url, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
    } catch (err) {
      if (isAbortError(err)) return;
      throw toGraphClientError(err, url);
    }

    if (!response.ok || !response.body) {
      const envelopeError = await tryParseFailureEnvelope(response);
      throw new GraphClientError(
        envelopeError?.code ?? 'bad_response',
        envelopeError?.message ?? `Failed to open stream at ${url} (HTTP ${response.status})`,
        response.status,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let separatorIndex = buffer.indexOf('\n\n');
        while (separatorIndex !== -1) {
          const rawFrame = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const frame = parseSseFrame(rawFrame);
          if (frame && frame.event === 'change') {
            let row: WireChangeLogRow;
            try {
              row = JSON.parse(frame.data) as WireChangeLogRow;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              throw new GraphClientError('bad_response', `Stream at ${url} sent a malformed change frame: ${message}`, null);
            }
            onDelta(toStreamDelta(row));
          }
          separatorIndex = buffer.indexOf('\n\n');
        }
      }
    } catch (err) {
      if (isAbortError(err)) return;
      throw toGraphClientError(err, url);
    }
  }

  async function loop(): Promise<void> {
    while (!closed) {
      try {
        await runOnce();
      } catch (err) {
        reportError(err);
      }
      if (closed) return;
      await new Promise<void>((resolve) => {
        reconnectTimer = setTimeout(resolve, RECONNECT_DELAY_MS);
      });
      reconnectTimer = null;
    }
  }

  void loop();

  return {
    close(): void {
      if (closed) return;
      closed = true;
      controller?.abort();
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    },
  };
}
