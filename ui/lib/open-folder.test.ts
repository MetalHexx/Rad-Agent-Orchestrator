import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import { resolveAndValidateFolder, openFolder } from './open-folder.js';

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
  mock.restoreAll();
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
  delete process.env.OPEN_FOLDER_DRY_RUN;
  delete process.env.OPEN_FOLDER_FORCE_FAIL;
});

interface SpawnRecord {
  cmd: string;
  args: string[];
}

/** Fake child that emits `spawn` (or `error`) on the next tick. */
function stubSpawn(emit: 'spawn' | 'error'): { calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = [];
  mock.method(child_process, 'spawn', (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {};
    setImmediate(() => child.emit(emit, emit === 'error' ? new Error('ENOENT') : undefined));
    return child as unknown as child_process.ChildProcess;
  });
  return { calls };
}

// ─── resolveAndValidateFolder ────────────────────────────────────────────────

test('resolveAndValidateFolder rejects a missing/empty path', () => {
  assert.ok('error' in resolveAndValidateFolder(undefined));
  assert.ok('error' in resolveAndValidateFolder(''));
  assert.ok('error' in resolveAndValidateFolder('   '));
});

test('resolveAndValidateFolder rejects `..` traversal', () => {
  const r = resolveAndValidateFolder('~/.radorc/worktrees/../../etc/passwd');
  assert.ok('error' in r);
});

test('resolveAndValidateFolder allows a legit name that merely contains `..`', () => {
  // `foo..bar` is a valid folder name — only a path segment that IS `..` is traversal.
  const r = resolveAndValidateFolder('~/.radorc/worktrees/foo..bar/repo');
  assert.ok('absPath' in r, '`foo..bar` must not be rejected as traversal');
});

test('resolveAndValidateFolder rejects a path outside the allowed roots', () => {
  const r = resolveAndValidateFolder('~/Downloads/evil');
  assert.ok('error' in r, 'a home path outside ~/.radorc must be rejected');
});

test('resolveAndValidateFolder accepts and expands a ~/.radorc/worktrees path', () => {
  const r = resolveAndValidateFolder('~/.radorc/worktrees/FAKE-NEWS/fake-api/');
  assert.ok('absPath' in r, 'worktree path must be accepted');
  if ('absPath' in r) {
    const expectedRoot = path.join(os.homedir(), '.radorc', 'worktrees');
    assert.ok(r.absPath.startsWith(expectedRoot + path.sep), 'resolves under the worktrees root');
    assert.ok(!r.absPath.includes('~'), 'tilde is expanded');
  }
});

test('resolveAndValidateFolder accepts a side-projects path', () => {
  const r = resolveAndValidateFolder('~/.radorc/side-projects/TOY/');
  assert.ok('absPath' in r);
});

// ─── openFolder ──────────────────────────────────────────────────────────────

test('openFolder uses explorer on win32 with the absolute path', async () => {
  setPlatform('win32');
  const { calls } = stubSpawn('spawn');
  const res = await openFolder('C:\\Users\\x\\.radorc\\worktrees\\P\\r');
  assert.equal(res.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'explorer');
  assert.deepEqual(calls[0].args, ['C:\\Users\\x\\.radorc\\worktrees\\P\\r']);
});

test('openFolder uses open on darwin', async () => {
  setPlatform('darwin');
  const { calls } = stubSpawn('spawn');
  const res = await openFolder('/Users/x/.radorc/worktrees/P/r');
  assert.equal(res.success, true);
  assert.equal(calls[0].cmd, 'open');
});

test('openFolder uses xdg-open on linux', async () => {
  setPlatform('linux');
  const { calls } = stubSpawn('spawn');
  const res = await openFolder('/home/x/.radorc/worktrees/P/r');
  assert.equal(res.success, true);
  assert.equal(calls[0].cmd, 'xdg-open');
});

test('openFolder reports failure when the spawn errors', async () => {
  setPlatform('linux');
  stubSpawn('error');
  const res = await openFolder('/home/x/.radorc/worktrees/P/r');
  assert.equal(res.success, false);
  assert.equal(typeof res.error, 'string');
});

test('openFolder honors OPEN_FOLDER_DRY_RUN without spawning', async () => {
  process.env.OPEN_FOLDER_DRY_RUN = '1';
  const spy = mock.method(child_process, 'spawn', () => {
    throw new Error('spawn must not be called under dry run');
  });
  const res = await openFolder('/anything');
  assert.equal(res.success, true);
  assert.equal(spy.mock.calls.length, 0);
});

console.log('open-folder ✓');
