import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withHomedir } from '@/lib/test-helpers';
import { __resetLiveRuntimeForTest, getLiveRuntime } from '@/lib/live/live-hub-runtime';
import { deriveProjectState } from '@rad-orchestration/work-graph';

function fakeWatcher() {
  const e = new EventEmitter() as EventEmitter & { close: () => Promise<void> };
  e.close = async () => {};
  return e;
}

/** Pulls the next complete `event: ...\ndata: ...\n\n` SSE frame off a reader, buffering partial reads. */
function frameReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(): Promise<{ type: string; payload: unknown }> {
      for (;;) {
        const sep = buffer.indexOf('\n\n');
        if (sep !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) throw new Error(`frame carried no data line: ${frame}`);
          return JSON.parse(dataLine.slice('data: '.length));
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended before a full SSE frame arrived');
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

test('the state_change SSE frame carries a server-derived projectState matching deriveProjectState on the raw state.json, recomputed per event', async () => {
  __resetLiveRuntimeForTest();

  const home = mkdtempSync(path.join(tmpdir(), 'events-route-state-'));
  const projectsDir = path.join(home, '.radorc', 'projects');
  mkdirSync(path.join(projectsDir, 'DEMO'), { recursive: true });
  const stateFile = path.join(projectsDir, 'DEMO', 'state.json');

  const executingState = {
    pipeline: { current_tier: 'execution' },
    graph: { status: 'in_progress', nodes: { phase_loop: { status: 'in_progress' } } },
  };
  writeFileSync(stateFile, JSON.stringify(executingState));

  const watcher = fakeWatcher();
  // Pre-warm the process-level runtime singleton with an injected watcher and this
  // fixture's real projectsDir. route.ts's own getLiveRuntime(...) call below is
  // constructed with production args (getProjectsRoot() etc.), but the singleton is
  // already built by the time it runs — those args are ignored and this is the
  // instance the route actually rides. The state reads still hit the real disk file.
  getLiveRuntime({ projectsRoot: projectsDir, makeWatcher: () => watcher as never, coalesceWindowMs: 0 });

  const abortController = new AbortController();
  try {
    await withHomedir(home, async () => {
      const { GET } = await import('./route');
      const res = await GET(new Request('http://t/api/events', { signal: abortController.signal }));
      assert.ok(res.body, 'route returns a readable SSE body');

      const frames = frameReader(res.body!);

      // First frame is always 'connected' — drain it before driving a state change.
      const connected = await frames.next();
      assert.equal(connected.type, 'connected');

      watcher.emit('change', stateFile);
      const executingFrame = await frames.next();

      assert.equal(executingFrame.type, 'state_change');
      const executingPayload = executingFrame.payload as {
        projectName: string;
        state: unknown;
        projectState: { state: string; label: string };
      };
      assert.equal(executingPayload.projectName, 'DEMO');
      assert.deepEqual(executingPayload.state, executingState, 'the raw parsed state.json rides through unchanged');
      const expectedExecuting = deriveProjectState(executingState);
      assert.equal(executingPayload.projectState.state, expectedExecuting.state);
      assert.equal(executingPayload.projectState.label, expectedExecuting.label);
      assert.equal(executingPayload.projectState.state, 'executing');

      // Rewrite the same project's state.json to a different shape and fire a second
      // change — this proves the enrichment is derived fresh from each event's own
      // state rather than a value computed once and reused.
      const haltedState = { graph: { status: 'halted', nodes: {} } };
      writeFileSync(stateFile, JSON.stringify(haltedState));
      watcher.emit('change', stateFile);
      const haltedFrame = await frames.next();

      assert.equal(haltedFrame.type, 'state_change');
      const haltedPayload = haltedFrame.payload as {
        projectName: string;
        state: unknown;
        projectState: { state: string; label: string };
      };
      assert.deepEqual(haltedPayload.state, haltedState);
      const expectedHalted = deriveProjectState(haltedState);
      assert.equal(haltedPayload.projectState.state, expectedHalted.state);
      assert.equal(haltedPayload.projectState.label, expectedHalted.label);
      assert.equal(haltedPayload.projectState.state, 'halted');
      assert.notEqual(haltedPayload.projectState.state, executingPayload.projectState.state);

      await frames.cancel();
    });
  } finally {
    // Fires the route's abort cleanup (clears the heartbeat interval and unsubscribes
    // from the runtime) so this test leaves no pending timers behind.
    abortController.abort();
  }
});
