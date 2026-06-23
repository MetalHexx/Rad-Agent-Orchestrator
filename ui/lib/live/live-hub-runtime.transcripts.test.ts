import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getLiveRuntime, __resetLiveRuntimeForTest } from './live-hub-runtime';

function fakeWatcher() {
  const handlers: Record<string, ((p: unknown) => void)[]> = {};
  return {
    on(e: string, cb: (p: unknown) => void) { (handlers[e] ??= []).push(cb); return this; },
    emit(e: string, p?: unknown) { (handlers[e] ?? []).forEach((h) => h(p)); },
    close: async () => {},
  };
}
function manualClock() {
  const q: (() => void)[] = [];
  return { schedule(cb: () => void) { q.push(cb); return q.length; }, cancel() {}, flush() { while (q.length) q.shift()!(); } };
}

test('a change under transcripts/<sessionId>/agent-<id>.json emits transcript_change with parsed identity (FR-10, AD-2)', () => {
  __resetLiveRuntimeForTest();
  const root = path.join('/tele', 'transcripts');
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({
    projectsRoot: '/p',
    transcriptsRoot: root,
    makeWatcher: () => fakeWatcher() as never,
    makeTranscriptWatcher: () => w as never,
    scheduler: clock,
  });
  const got: Array<{ sessionId: string; agentId?: string; kind: string }> = [];
  const off = rt.subscribeTranscripts((n) => got.push(n.payload));
  w.emit('change', path.join(root, 'sess-1', 'agent-aa37.json'));
  clock.flush();
  off();
  rt.teardown();
  assert.deepEqual(got, [{ sessionId: 'sess-1', agentId: 'aa37', kind: 'changed' }],
    'derives sessionId from the dir, agentId from agent-<id>.json, kind from the fs op');
});

test('a change to main.json carries no agentId (FR-10, AD-2)', () => {
  __resetLiveRuntimeForTest();
  const root = path.join('/tele', 'transcripts');
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({ projectsRoot: '/p', transcriptsRoot: root, makeWatcher: () => fakeWatcher() as never, makeTranscriptWatcher: () => w as never, scheduler: clock });
  const got: Array<{ sessionId: string; agentId?: string; kind: string }> = [];
  const off = rt.subscribeTranscripts((n) => got.push(n.payload));
  w.emit('add', path.join(root, 'sess-9', 'main.json'));
  clock.flush();
  off(); rt.teardown();
  assert.deepEqual(got, [{ sessionId: 'sess-9', kind: 'added' }], 'main.json → no agentId, kind added');
});
