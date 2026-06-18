import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { __resetLiveRuntimeForTest, getLiveRuntime } from './live-hub-runtime';

function fakeWatcher() {
  const e = new EventEmitter() as EventEmitter & { close: () => Promise<void> };
  e.close = async () => {};
  return e;
}

// A fake watcher that records how many times close() was called, so a test can
// assert the runtime tears down the outgoing watcher on restart (Defect 1).
function spyWatcher() {
  const e = new EventEmitter() as EventEmitter & { close: () => Promise<void>; closeCount: number };
  e.closeCount = 0;
  e.close = async () => { e.closeCount += 1; };
  return e;
}

// Builds a makeWatcher factory that hands out a fixed sequence of fake watchers,
// one per (re)start, so a test can drive restarts across distinct instances.
function watcherSequence(watchers: Array<ReturnType<typeof spyWatcher>>) {
  let i = 0;
  return () => watchers[Math.min(i++, watchers.length - 1)] as never;
}

function manualClock() {
  let pending: Array<() => void> = [];
  return {
    schedule: (cb: () => void) => { pending.push(cb); return pending.length; },
    cancel: () => {},
    flush: () => { const p = pending; pending = []; p.forEach((c) => c()); },
  };
}

test('a burst of changes coalesces to one artifact_change notification via the real all-topics subscribe (FR-12, NFR-4, AD-4)', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({ projectsRoot: '/p', makeWatcher: () => w as never, coalesceWindowMs: 50, scheduler: clock });
  const got: Array<{ type: string; payload: { projectName: string; kind: string } }> = [];
  const off = rt.subscribeAllArtifactTopics((notif) => got.push(notif));
  w.emit('change', '/p/DEMO/DEMO-BRAINSTORMING.md');
  w.emit('change', '/p/DEMO/DEMO-BRAINSTORM.html');
  assert.equal(got.length, 0, 'nothing delivered before the coalesce window flushes');
  clock.flush();
  assert.equal(got.length, 1, 'two DEMO writes coalesced into one notification through subscribeAll');
  assert.equal(got[0].type, 'artifact_change');
  assert.equal(got[0].payload.projectName, 'DEMO');
  off();
});

test('the all-topics subscribe fans in changes from multiple projects (FR-11, AD-5, AD-4)', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({ projectsRoot: '/p', makeWatcher: () => w as never, coalesceWindowMs: 50, scheduler: clock });
  const got: string[] = [];
  const off = rt.subscribeAllArtifactTopics((n) => got.push(n.payload.projectName));
  w.emit('change', '/p/ALPHA/ALPHA-BRAINSTORMING.md');
  w.emit('add', '/p/BETA/BETA-BRAINSTORM.html');
  clock.flush();
  assert.deepEqual(got.sort(), ['ALPHA', 'BETA'], 'one connection-level subscribe receives every project topic');
  off();
});

test('unsubscribe drops only the in-memory subscriber; the watcher stays warm (NFR-1, AD-5)', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  let closed = false;
  w.close = async () => { closed = true; };
  const rt = getLiveRuntime({ projectsRoot: '/p', makeWatcher: () => w as never, coalesceWindowMs: 0 });
  const off = rt.subscribeAllArtifactTopics(() => {});
  off();
  assert.equal(closed, false, 'disconnect never tears down the shared watcher');
});

test('supervisor degradation surfaces a live_degraded notification (FR-17, AD-13)', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  const rt = getLiveRuntime({ projectsRoot: '/p', makeWatcher: () => w as never, coalesceWindowMs: 0, maxRestarts: 0 });
  const got: Array<{ type: string }> = [];
  rt.subscribeDegraded((n) => got.push(n));
  w.emit('error', new Error('dead'));
  assert.deepEqual(got, [{ type: 'live_degraded', payload: { degraded: true } }]);
});

test('a restart closes the outgoing watcher so fs handles do not leak (Defect 1)', () => {
  __resetLiveRuntimeForTest();
  const first = spyWatcher();
  const second = spyWatcher();
  const rt = getLiveRuntime({
    projectsRoot: '/p',
    makeWatcher: watcherSequence([first, second]),
    coalesceWindowMs: 0,
    maxRestarts: 1,
  });
  // Keep the runtime referenced so it is not flagged unused; no subscription needed
  // for this lifecycle assertion.
  void rt;
  first.emit('error', new Error('transient')); // budget allows one restart
  assert.equal(first.closeCount, 1, 'the previous watcher is closed exactly once on restart');
});

test('a healthy ready signal resets the restart budget so transient errors do not degrade (Defect 2)', () => {
  __resetLiveRuntimeForTest();
  const first = spyWatcher();
  const second = spyWatcher();
  const third = spyWatcher();
  const rt = getLiveRuntime({
    projectsRoot: '/p',
    makeWatcher: watcherSequence([first, second, third]),
    coalesceWindowMs: 0,
    maxRestarts: 1,
  });
  const degraded: Array<{ type: string }> = [];
  rt.subscribeDegraded((n) => degraded.push(n));
  first.emit('error', new Error('transient')); // restart #1 consumes the budget
  second.emit('ready'); // a healthy (re)start should reset the budget
  second.emit('error', new Error('transient')); // would degrade if the budget had not reset
  assert.deepEqual(degraded, [], 'a healthy ready signal reset the budget, so no degrade fired');
});

test('the /api/events route pins the Node runtime and stays dynamic (AD-12)', () => {
  const route = readFileSync(
    path.join(process.cwd(), 'app', 'api', 'events', 'route.ts'),
    'utf-8',
  );
  assert.match(route, /export\s+const\s+runtime\s*=\s*['"]nodejs['"]/, 'SSE route declares the Node runtime');
  assert.match(route, /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/, 'SSE route stays dynamic / non-cached');
});

test('a state.json change delivers the full parsed state over the state topic, read once at the hub (FR-1, NFR-5, DD-1)', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({
    projectsRoot: '/p',
    makeWatcher: () => w as never,
    coalesceWindowMs: 50,
    scheduler: clock,
    readStateFile: () => JSON.stringify({ project: { name: 'DEMO' }, graph: { nodes: {} } }),
  });
  const got: Array<{ type: string; payload: { projectName: string; state: unknown } }> = [];
  const off = rt.subscribeAllStateTopics((n) => got.push(n));
  w.emit('change', '/p/DEMO/state.json');
  clock.flush();
  assert.equal(got.length, 1, 'one state_change delivered for a DEMO state.json change');
  assert.equal(got[0].type, 'state_change');
  assert.equal(got[0].payload.projectName, 'DEMO');
  assert.deepEqual(got[0].payload.state, { project: { name: 'DEMO' }, graph: { nodes: {} } });
  off();
});

test('a burst of state.json writes coalesces to one state_change per project (NFR-4)', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({
    projectsRoot: '/p',
    makeWatcher: () => w as never,
    coalesceWindowMs: 50,
    scheduler: clock,
    readStateFile: () => JSON.stringify({ graph: { nodes: {} } }),
  });
  const got: string[] = [];
  const off = rt.subscribeAllStateTopics((n) => got.push(n.payload.projectName));
  w.emit('change', '/p/DEMO/state.json');
  w.emit('change', '/p/DEMO/state.json');
  w.emit('change', '/p/DEMO/state.json');
  clock.flush();
  assert.deepEqual(got, ['DEMO'], 'three rapid DEMO writes coalesce to one delivery');
  off();
});

test('a project directory created without a state.json fires project_added (FR-3, FR-4, DD-3)', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({ projectsRoot: '/p', makeWatcher: () => w as never, coalesceWindowMs: 50, scheduler: clock });
  const got: Array<{ type: string; payload: { projectName: string }; timestamp?: string }> = [];
  const off = rt.subscribeLifecycle((n) => got.push(n));
  w.emit('addDir', '/p/DOCONLY');
  clock.flush();
  assert.deepEqual(got, [{ type: 'project_added', payload: { projectName: 'DOCONLY' }, timestamp: got[0]?.timestamp }]);
  off();
});

test('a project directory removal fires project_removed (FR-3, DD-3)', () => {
  __resetLiveRuntimeForTest();
  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({ projectsRoot: '/p', makeWatcher: () => w as never, coalesceWindowMs: 50, scheduler: clock });
  const got: Array<{ type: string; payload: { projectName: string }; timestamp?: string }> = [];
  const off = rt.subscribeLifecycle((n) => got.push(n));
  w.emit('unlinkDir', '/p/OLD');
  clock.flush();
  assert.deepEqual(got, [{ type: 'project_removed', payload: { projectName: 'OLD' }, timestamp: got[0]?.timestamp }]);
  off();
});

test('a repo-registry.yml change fires an empty registry nudge from the registry watch root (FR-2, AD-2, DD-2)', () => {
  __resetLiveRuntimeForTest();
  const projectsW = fakeWatcher();
  const registryW = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({
    projectsRoot: '/home/.radorc/projects',
    registryRoot: '/home/.radorc',
    makeWatcher: () => projectsW as never,
    makeRegistryWatcher: () => registryW as never,
    coalesceWindowMs: 50,
    scheduler: clock,
  });
  const got: Array<{ type: string; payload: Record<string, never> }> = [];
  const off = rt.subscribeRegistry((n) => got.push(n));
  registryW.emit('change', '/home/.radorc/repo-registry.yml');
  clock.flush();
  assert.equal(got.length, 1, 'one registry nudge delivered');
  assert.equal(got[0].type, 'registry_change');
  assert.deepEqual(got[0].payload, {});
  off();
});

test('the local registry override file also fires a nudge; a non-registry file does not (FR-2)', () => {
  __resetLiveRuntimeForTest();
  const projectsW = fakeWatcher();
  const registryW = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({
    projectsRoot: '/home/.radorc/projects',
    registryRoot: '/home/.radorc',
    makeWatcher: () => projectsW as never,
    makeRegistryWatcher: () => registryW as never,
    coalesceWindowMs: 50,
    scheduler: clock,
  });
  const got: string[] = [];
  const off = rt.subscribeRegistry((n) => got.push(n.type));
  registryW.emit('change', '/home/.radorc/repo-registry.local.yml');
  registryW.emit('change', '/home/.radorc/orchestration.yml');
  clock.flush();
  assert.deepEqual(got, ['registry_change'], 'only registry files nudge; orchestration.yml is ignored');
  off();
});

test('a registry watcher error restarts the registry watcher, not the projects watcher (NFR-6 registry resilience)', () => {
  __resetLiveRuntimeForTest();
  const proj = spyWatcher();
  const reg1 = spyWatcher();
  const reg2 = spyWatcher();
  const rt = getLiveRuntime({
    projectsRoot: '/home/.radorc/projects',
    registryRoot: '/home/.radorc',
    makeWatcher: () => proj as never,
    makeRegistryWatcher: watcherSequence([reg1, reg2]),
    coalesceWindowMs: 0,
    maxRestarts: 1,
  });
  void rt;
  reg1.emit('error', new Error('registry watch died')); // budget allows one registry restart
  assert.equal(reg1.closeCount, 1, 'the failed registry watcher is closed on its own restart');
  assert.equal(proj.closeCount, 0, 'a registry error must not restart/close the projects watcher');
});

test('a registry error does not consume the projects watcher restart budget (independent supervisors, NFR-6)', () => {
  __resetLiveRuntimeForTest();
  const proj1 = spyWatcher();
  const proj2 = spyWatcher();
  const reg1 = spyWatcher();
  const reg2 = spyWatcher();
  const rt = getLiveRuntime({
    projectsRoot: '/home/.radorc/projects',
    registryRoot: '/home/.radorc',
    makeWatcher: watcherSequence([proj1, proj2]),
    makeRegistryWatcher: watcherSequence([reg1, reg2]),
    coalesceWindowMs: 0,
    maxRestarts: 1,
  });
  const degraded: Array<{ type: string }> = [];
  rt.subscribeDegraded((n) => degraded.push(n));
  reg1.emit('error', new Error('registry fail'));   // consumes the REGISTRY budget (restart #1)
  proj1.emit('error', new Error('projects fail'));  // projects still has its full budget → restarts
  assert.deepEqual(degraded, [], 'neither surface degraded: each restart drew from its own budget');
  assert.equal(proj1.closeCount, 1, 'the projects watcher restarted on its own untouched budget');
});

test('a registry change never reaches an artifact subscriber (AD-1 topic isolation)', () => {
  __resetLiveRuntimeForTest();
  const projectsW = fakeWatcher();
  const registryW = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({
    projectsRoot: '/home/.radorc/projects',
    registryRoot: '/home/.radorc',
    makeWatcher: () => projectsW as never,
    makeRegistryWatcher: () => registryW as never,
    coalesceWindowMs: 50,
    scheduler: clock,
  });
  const got: unknown[] = [];
  const off = rt.subscribeAllArtifactTopics((n) => got.push(n));
  registryW.emit('change', '/home/.radorc/repo-registry.yml');
  clock.flush();
  assert.equal(got.length, 0, 'a registry event must not be delivered to artifact subscribers');
  off();
});

// ── Telemetry watcher integration ───────────────────────────────────────────
// Drives the real add/change/ready wiring through makeTelemetryWatcher. The P04
// review flagged that this runtime wiring had no integration test; these cover
// the seeding, teardown, and migration-coalesce behavior end-to-end.

function telemetryTmpDir(): string { return mkdtempSync(path.join(tmpdir(), 'telem-rt-')); }
// The flush debounce uses a real 50 ms setTimeout (not the injected scheduler),
// so wait past it, then flush the hub clock to deliver the coalesced batch.
const flushTick = () => new Promise<void>((resolve) => setTimeout(resolve, 90));

test('the telemetry watcher delivers the first append to a partition present at startup, seeded at EOF on ready (FR-10, FR-11, FR-12)', async () => {
  __resetLiveRuntimeForTest();
  const dir = telemetryTmpDir();
  const fp = path.join(dir, 'usage-2026-06-18-abc.ndjson');
  // A partition already on disk when the watcher starts (the common "current day" file).
  writeFileSync(fp, JSON.stringify({ sessionId: 's1', usageId: 'pre1', timestamp: '2026-06-18T00:00:00Z', inputTokens: 1, outputTokens: 2 }) + '\n');

  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({
    projectsRoot: '/p',
    telemetryRoot: dir,
    makeWatcher: () => fakeWatcher() as never,
    makeTelemetryWatcher: () => w as never,
    coalesceWindowMs: 50,
    scheduler: clock,
  });
  const got: Array<{ usageId?: string }> = [];
  const off = rt.subscribeTelemetry((n) => got.push(...n.payload.rows));

  w.emit('ready'); // seeds fp at its current (pre-append) EOF

  appendFileSync(fp, JSON.stringify({ sessionId: 's1', usageId: 'new1', timestamp: '2026-06-18T01:00:00Z', inputTokens: 3, outputTokens: 4 }) + '\n');
  w.emit('change', fp);

  await flushTick();
  clock.flush();
  off();
  rt.teardown();

  assert.deepEqual(got.map((r) => r.usageId), ['new1'],
    'the first post-start append is delivered once; the pre-existing row is not re-emitted');
});

test('teardown cancels a pending telemetry flush debounce so no batch publishes afterward (clean teardown)', async () => {
  __resetLiveRuntimeForTest();
  const dir = telemetryTmpDir();
  const fp = path.join(dir, 'usage-2026-06-18-xyz.ndjson');

  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({
    projectsRoot: '/p',
    telemetryRoot: dir,
    makeWatcher: () => fakeWatcher() as never,
    makeTelemetryWatcher: () => w as never,
    coalesceWindowMs: 50,
    scheduler: clock,
  });
  const got: Array<{ usageId?: string }> = [];
  const off = rt.subscribeTelemetry((n) => got.push(...n.payload.rows));

  w.emit('ready');
  writeFileSync(fp, JSON.stringify({ sessionId: 's1', usageId: 'u1', timestamp: '2026-06-18T00:00:00Z', inputTokens: 0, outputTokens: 0 }) + '\n');
  w.emit('add', fp);   // 'add' seeds offset 0 and schedules a 50 ms flush debounce
  rt.teardown();       // must cancel the pending debounce

  await flushTick();
  clock.flush();
  off();

  assert.deepEqual(got, [], 'the pending flush debounce was cancelled at teardown — nothing published');
});

test('the live tail coalesces a legacy radOrcId row to usageId, matching the history read path (AD-9)', async () => {
  __resetLiveRuntimeForTest();
  const dir = telemetryTmpDir();
  const fp = path.join(dir, 'usage-2026-06-18-leg.ndjson');

  const w = fakeWatcher();
  const clock = manualClock();
  const rt = getLiveRuntime({
    projectsRoot: '/p',
    telemetryRoot: dir,
    makeWatcher: () => fakeWatcher() as never,
    makeTelemetryWatcher: () => w as never,
    coalesceWindowMs: 50,
    scheduler: clock,
  });
  const got: Array<{ usageId?: string }> = [];
  const off = rt.subscribeTelemetry((n) => got.push(...n.payload.rows));

  w.emit('ready');
  // A brand-new partition (seeded at 0 by the 'add' handler) whose first row is a
  // legacy radOrcId-only record (pre-rename schema — AD-9 migration window).
  writeFileSync(fp, JSON.stringify({ sessionId: 's1', radOrcId: 'legacy1', timestamp: '2026-06-18T00:00:00Z', inputTokens: 1, outputTokens: 2 }) + '\n');
  w.emit('add', fp);

  await flushTick();
  clock.flush();
  off();
  rt.teardown();

  assert.deepEqual(got.map((r) => r.usageId), ['legacy1'],
    'radOrcId is coalesced into usageId on the live path, not emitted as undefined');
});
