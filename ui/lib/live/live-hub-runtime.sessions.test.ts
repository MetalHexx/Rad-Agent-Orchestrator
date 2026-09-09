import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('a `.project-sessions.json` write reaches subscribeAllSessionsTopics with a project-name-only nudge', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({ projectsRoot: '/p', makeWatcher: () => w as never, scheduler: clock });
  const got: Array<{ type: string; payload: { projectName: string } }> = [];
  const off = rt.subscribeAllSessionsTopics((n) => got.push(n));
  w.emit('change', '/p/DEMO/.project-sessions.json');
  clock.flush();
  off();
  rt.teardown();
  assert.equal(got.length, 1);
  assert.equal(got[0].type, 'sessions_change');
  assert.deepEqual(got[0].payload, { projectName: 'DEMO' });
});

test('a `.project-sessions.json` write does NOT reach subscribeAllArtifactTopics (the exclusion regression)', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({ projectsRoot: '/p', makeWatcher: () => w as never, scheduler: clock });
  const artifactEvents: unknown[] = [];
  const offArtifacts = rt.subscribeAllArtifactTopics((n) => artifactEvents.push(n));
  const sessionsEvents: unknown[] = [];
  const offSessions = rt.subscribeAllSessionsTopics((n) => sessionsEvents.push(n));
  w.emit('change', '/p/DEMO/.project-sessions.json');
  clock.flush();
  offArtifacts();
  offSessions();
  rt.teardown();
  assert.equal(artifactEvents.length, 0, 'a sessions write must never pulse an unrelated artifact tile');
  assert.equal(sessionsEvents.length, 1);
});

test('a lock-file sibling write publishes nothing on either topic', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({ projectsRoot: '/p', makeWatcher: () => w as never, scheduler: clock });
  const artifactEvents: unknown[] = [];
  const offArtifacts = rt.subscribeAllArtifactTopics((n) => artifactEvents.push(n));
  const sessionsEvents: unknown[] = [];
  const offSessions = rt.subscribeAllSessionsTopics((n) => sessionsEvents.push(n));
  w.emit('change', '/p/DEMO/.project-sessions.json.lock');
  w.emit('add', '/p/DEMO/.project-sessions.json.4821.tmp');
  clock.flush();
  offArtifacts();
  offSessions();
  rt.teardown();
  assert.equal(artifactEvents.length, 0);
  assert.equal(sessionsEvents.length, 0);
});
