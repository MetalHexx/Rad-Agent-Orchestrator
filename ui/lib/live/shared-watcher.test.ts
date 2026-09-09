import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  __resetSharedWatcherForTest,
  getSharedWatcher,
  closeSharedWatcherIfActive,
  reopenSharedWatcherIfActive,
} from './shared-watcher';

function fakeFactory() {
  let created = 0;
  const emitter = new EventEmitter() as EventEmitter & { close: () => Promise<void> };
  emitter.close = async () => {};
  return {
    calls: () => created,
    make: () => { created += 1; return emitter; },
    emitter,
  };
}

// Unlike fakeFactory (one reused emitter), each make() call here returns a
// distinct instance with its own close-call counter, so a test can tell the
// outgoing (closed) watcher apart from a freshly reopened one.
function trackedFactory() {
  const created: Array<EventEmitter & { close: () => Promise<void>; closeCount: number }> = [];
  return {
    created,
    make: () => {
      const e = new EventEmitter() as EventEmitter & { close: () => Promise<void>; closeCount: number };
      e.closeCount = 0;
      e.close = async () => { e.closeCount += 1; };
      created.push(e);
      return e;
    },
  };
}

test('watcher is created lazily on first subscribe and reused (HMR-safe singleton)', () => {
  __resetSharedWatcherForTest();
  const f = fakeFactory();
  const w1 = getSharedWatcher({ projectsRoot: '/p', makeWatcher: f.make });
  assert.equal(f.calls(), 0, 'no watcher before first subscribe');
  const off1 = w1.subscribe(() => {});
  assert.equal(f.calls(), 1, 'created on first subscribe');
  const w2 = getSharedWatcher({ projectsRoot: '/p', makeWatcher: f.make });
  const off2 = w2.subscribe(() => {});
  assert.equal(f.calls(), 1, 'second getSharedWatcher reuses the singleton — no second watcher');
  off1(); off2();
});

test('normalizes chokidar add/change/unlink into typed listener events (FR-11, FR-3)', () => {
  __resetSharedWatcherForTest();
  const f = fakeFactory();
  const w = getSharedWatcher({ projectsRoot: '/p', makeWatcher: f.make });
  const seen: Array<{ type: string; filePath: string }> = [];
  w.subscribe((e) => seen.push(e));
  f.emitter.emit('add', '/p/DEMO/DEMO-BRAINSTORMING.md');
  f.emitter.emit('change', '/p/DEMO/DEMO-BRAINSTORM.html');
  f.emitter.emit('unlink', '/p/DEMO/old.html');
  assert.deepEqual(seen, [
    { type: 'add', filePath: '/p/DEMO/DEMO-BRAINSTORMING.md' },
    { type: 'change', filePath: '/p/DEMO/DEMO-BRAINSTORM.html' },
    { type: 'unlink', filePath: '/p/DEMO/old.html' },
  ]);
});

test('close() closes the underlying watcher without dropping subscribers; reopen() re-arms and delivers to them again', async () => {
  __resetSharedWatcherForTest();
  const f = trackedFactory();
  const w = getSharedWatcher({ projectsRoot: '/p', makeWatcher: f.make });
  const seen: Array<{ type: string; filePath: string }> = [];
  const off = w.subscribe((e) => seen.push(e));
  assert.equal(f.created.length, 1, 'one watcher constructed on first subscribe');

  await w.close();
  assert.equal(f.created[0]!.closeCount, 1, 'close() closed the underlying watcher');
  assert.equal(f.created.length, 1, 'close() must not construct a new watcher');

  w.reopen();
  assert.equal(f.created.length, 2, 'reopen() re-arms via ensureWatcher() because a listener is still registered');

  f.created[1]!.emit('add', '/p/DEMO/new.html');
  assert.deepEqual(seen, [{ type: 'add', filePath: '/p/DEMO/new.html' }],
    'the subscriber registered before the close is still receiving events after the reopen');
  off();
});

test('reopen() is a no-op when no listeners are left to serve', () => {
  __resetSharedWatcherForTest();
  const f = trackedFactory();
  const w = getSharedWatcher({ projectsRoot: '/p', makeWatcher: f.make });
  const off = w.subscribe(() => {});
  off();
  w.reopen();
  assert.equal(f.created.length, 1, 'reopen with no listeners left must not construct a watcher');
});

test('closeSharedWatcherIfActive and reopenSharedWatcherIfActive no-op on a cold module without constructing a watcher', async () => {
  __resetSharedWatcherForTest();
  const f = trackedFactory();
  await closeSharedWatcherIfActive();
  reopenSharedWatcherIfActive();
  assert.equal(f.created.length, 0, 'neither helper may construct a watcher when no singleton exists (the injected factory was never called)');
});

test('closeSharedWatcherIfActive and reopenSharedWatcherIfActive operate on the active singleton', async () => {
  __resetSharedWatcherForTest();
  const f = trackedFactory();
  const w = getSharedWatcher({ projectsRoot: '/p', makeWatcher: f.make });
  const seen: Array<{ type: string; filePath: string }> = [];
  const off = w.subscribe((e) => seen.push(e));

  await closeSharedWatcherIfActive();
  assert.equal(f.created[0]!.closeCount, 1, 'the module-level close helper closed the active singleton');

  reopenSharedWatcherIfActive();
  assert.equal(f.created.length, 2, 'the module-level reopen helper re-armed the active singleton');
  f.created[1]!.emit('change', '/p/DEMO/x.md');
  assert.deepEqual(seen, [{ type: 'change', filePath: '/p/DEMO/x.md' }]);
  off();
});
