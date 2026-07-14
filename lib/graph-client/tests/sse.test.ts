import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribe } from '../src/sse.js';
import { GraphClientError } from '../src/errors.js';
import type { GraphClientConfig } from '../src/client.js';
import type { StreamDelta } from '../src/types.js';

const RECONNECT_WAIT_MS = 1_200; // just clears the module's fixed 1s reconnect delay

const wireRow = {
  seq: 1,
  project_id: 'p1',
  ts: '2026-01-01T00:00:00.000Z',
  actor: null,
  primitive: 'add_dependency',
  params: {},
  node_changes: [],
  edge_changes: [],
};

function changeFrame(row: unknown, seq: number): string {
  return `event: change\nid: ${seq}\ndata: ${JSON.stringify(row)}\n\n`;
}

/** A stream that emits `chunks` synchronously then closes — simulates a normal stream end. */
function closingStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
      } else {
        controller.close();
      }
    },
  });
}

/** A stream that emits `chunks` then stays open until the fetch's AbortSignal fires — mirrors
 * how a real `fetch` response body errors once its request is aborted. */
function abortableStream(chunks: string[], signal: AbortSignal | undefined): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      signal?.addEventListener('abort', () => {
        controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    },
  });
}

function config(fetchStub: typeof fetch): GraphClientConfig {
  return { baseUrl: 'http://127.0.0.1:1', fetch: fetchStub };
}

describe('subscribe()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses a change frame into a typed StreamDelta and invokes onDelta', async () => {
    const stub = vi.fn(async () => new Response(closingStream([changeFrame(wireRow, 1)]), { status: 200 }));
    const received: StreamDelta[] = [];
    const sub = subscribe(config(stub as unknown as typeof fetch), 'p1', (delta) => received.push(delta));

    await vi.advanceTimersByTimeAsync(0);

    expect(received).toEqual([
      {
        seq: 1,
        projectId: 'p1',
        ts: '2026-01-01T00:00:00.000Z',
        actor: null,
        primitive: 'add_dependency',
        params: {},
        nodeChanges: [],
        edgeChanges: [],
      },
    ]);
    expect(stub.mock.calls[0]?.[0]).toBe('http://127.0.0.1:1/engine-graph/stream?project=p1');

    sub.close();
  });

  it('reconnects once after a stream end', async () => {
    const stub = vi
      .fn()
      .mockResolvedValueOnce(new Response(closingStream([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(closingStream([]), { status: 200 }));
    const sub = subscribe(config(stub as unknown as typeof fetch), 'p1', () => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(stub).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS);
    expect(stub).toHaveBeenCalledTimes(2);

    sub.close();
  });

  it('reports a stream open failure to onError as a GraphClientError, then still reconnects', async () => {
    const stub = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response(closingStream([]), { status: 200 }));
    const onError = vi.fn();
    const sub = subscribe(config(stub as unknown as typeof fetch), 'p1', () => {}, { onError });

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    const reportedError = onError.mock.calls[0]?.[0] as GraphClientError;
    expect(reportedError).toBeInstanceOf(GraphClientError);
    expect(reportedError.code).toBe('network_error');

    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS);
    expect(stub).toHaveBeenCalledTimes(2);

    sub.close();
  });

  it('reports a malformed change frame as bad_response, not network_error', async () => {
    const malformedFrame = 'event: change\nid: 1\ndata: {not-json\n\n';
    const stub = vi.fn(async () => new Response(closingStream([malformedFrame]), { status: 200 }));
    const received: StreamDelta[] = [];
    const onError = vi.fn();
    const sub = subscribe(config(stub as unknown as typeof fetch), 'p1', (delta) => received.push(delta), { onError });

    await vi.advanceTimersByTimeAsync(0);

    expect(received).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1);
    const reportedError = onError.mock.calls[0]?.[0] as GraphClientError;
    expect(reportedError).toBeInstanceOf(GraphClientError);
    expect(reportedError.code).toBe('bad_response');

    sub.close();
  });

  it('close() stops the stream and prevents further callbacks and reconnects', async () => {
    let seenSignal: AbortSignal | undefined;
    const stub = vi.fn((_url: string, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return Promise.resolve(new Response(abortableStream([changeFrame(wireRow, 1)], seenSignal), { status: 200 }));
    });
    const received: StreamDelta[] = [];
    const sub = subscribe(config(stub as unknown as typeof fetch), 'p1', (delta) => received.push(delta));

    await vi.advanceTimersByTimeAsync(0);
    expect(received).toHaveLength(1);
    expect(stub).toHaveBeenCalledTimes(1);

    sub.close();
    expect(seenSignal?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
  });
});
