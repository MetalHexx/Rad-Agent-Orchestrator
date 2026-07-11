// graph-service/tests/harness/sse.ts
//
// An SSE collector for `/engine-graph/stream` (or `/work-graph/stream`): connects, parses the wire
// format `streams.ts` emits (`event: change`, `data: <json ChangeLogRow>`, `id: <seq>`), and records
// every delta in arrival order — plus two bounded waits a scenario needs: "at least N have arrived"
// and "the stream has gone quiet" (no delta for a grace window), since a daemon's own row-emission
// hook fires synchronously mid-request, well before the driving HTTP call's response returns.
export interface SseDelta {
  readonly event: string;
  readonly id: string | undefined;
  readonly data: unknown;
}

export interface SseCollector {
  /** Every delta received so far, in arrival order — a live view over the same underlying array. */
  readonly deltas: readonly SseDelta[];
  /** Resolves once at least `count` deltas have been collected, or rejects once `timeoutMs` elapses first. */
  waitForCount(count: number, timeoutMs?: number): Promise<void>;
  /** Resolves once no new delta has arrived for `quietMs` — a bounded "the stream has gone quiet" signal. */
  waitForQuiet(quietMs?: number, timeoutMs?: number): Promise<void>;
  /** Aborts the underlying connection. Safe to call once teardown no longer needs the stream. */
  close(): void;
}

function parseSseEvent(raw: string): SseDelta | null {
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('id:')) id = line.slice('id:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, id, data: JSON.parse(dataLines.join('\n')) as unknown };
}

/** Connects to `url` (an SSE endpoint) and starts collecting; rejects if the connection itself fails to open. */
export async function connectSse(url: string): Promise<SseCollector> {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
  if (!res.ok || !res.body) {
    throw new Error(`sse: failed to open stream at ${url}: HTTP ${res.status}`);
  }

  const deltas: SseDelta[] = [];
  let lastEventAt = Date.now();
  const countWaiters: { readonly count: number; readonly resolve: () => void }[] = [];

  function notifyCountWaiters(): void {
    for (let index = countWaiters.length - 1; index >= 0; index -= 1) {
      if (deltas.length >= countWaiters[index].count) {
        countWaiters[index].resolve();
        countWaiters.splice(index, 1);
      }
    }
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = (async (): Promise<void> => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let separatorIndex = buffer.indexOf('\n\n');
        while (separatorIndex !== -1) {
          const rawEvent = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const parsed = parseSseEvent(rawEvent);
          if (parsed) {
            deltas.push(parsed);
            lastEventAt = Date.now();
            notifyCountWaiters();
          }
          separatorIndex = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Aborted via `close()`, or the daemon went away (e.g. scenario 4's hard kill) — either is
      // the normal end of this stream's life, never a failure the collector itself surfaces.
    }
  })();
  void pump;

  return {
    get deltas(): readonly SseDelta[] {
      return deltas;
    },
    waitForCount(count: number, timeoutMs = 5_000): Promise<void> {
      if (deltas.length >= count) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`sse: timed out waiting for ${count} deltas (have ${deltas.length})`));
        }, timeoutMs);
        countWaiters.push({
          count,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      });
    },
    waitForQuiet(quietMs = 300, timeoutMs = 5_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      return new Promise<void>((resolve, reject) => {
        const check = (): void => {
          const idleMs = Date.now() - lastEventAt;
          if (idleMs >= quietMs) {
            resolve();
            return;
          }
          if (Date.now() > deadline) {
            reject(new Error('sse: timed out waiting for the stream to go quiet'));
            return;
          }
          setTimeout(check, Math.min(50, quietMs));
        };
        check();
      });
    },
    close(): void {
      controller.abort();
    },
  };
}
