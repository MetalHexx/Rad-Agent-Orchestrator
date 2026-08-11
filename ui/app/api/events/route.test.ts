import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runtime, dynamic } from './route';
import { discoverConnectedProjectNames } from './discover-connected-projects';

test('SSE events route pins the Node runtime and stays dynamic (AD-12)', () => {
  assert.equal(runtime, 'nodejs');
  assert.equal(dynamic, 'force-dynamic');
});

test('the connected payload only includes admitted project directory names', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'events-route-connected-'));
  try {
    await mkdir(path.join(tmpDir, 'REAL-PROJECT-1'));
    await mkdir(path.join(tmpDir, 'REAL-PROJECT-2.3.1'));
    await mkdir(path.join(tmpDir, '.git'));
    await mkdir(path.join(tmpDir, '_archived'));
    await mkdir(path.join(tmpDir, '_future'));
    await mkdir(path.join(tmpDir, 'lowercase-project'));
    await mkdir(path.join(tmpDir, 'C--Users-Metal--radorc-worktrees-MULTI-REPO-6'));

    const names = await discoverConnectedProjectNames(tmpDir);

    assert.deepEqual(new Set(names), new Set(['REAL-PROJECT-1', 'REAL-PROJECT-2.3.1']));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
