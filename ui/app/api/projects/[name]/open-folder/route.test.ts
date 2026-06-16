import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { NextRequest } from 'next/server';

let tmpDir = '';
let origHomedir: typeof os.homedir;

async function setup() {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'open-folder-'));
  origHomedir = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => tmpDir;
  // Dry-run: validate + resolve, but never spawn a real file explorer.
  process.env.OPEN_FOLDER_DRY_RUN = '1';
}

async function teardown() {
  (os as unknown as { homedir: typeof os.homedir }).homedir = origHomedir;
  delete process.env.OPEN_FOLDER_DRY_RUN;
  delete process.env.OPEN_FOLDER_FORCE_FAIL;
  await rm(tmpDir, { recursive: true, force: true });
}

async function invokePOST(body: unknown, name: string) {
  const { POST } = await import('./route');
  const req = new Request(`http://localhost/api/projects/${name}/open-folder`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as NextRequest, { params: { name } });
}

(async () => {
  await setup();
  try {
    // Invalid project name format → 400
    {
      const res = await invokePOST({ path: '~/.radorc/worktrees/DEMO/repo' }, 'bad..name');
      assert.equal(res.status, 400);
      console.log('✓ invalid project name → 400');
    }

    // Missing path → 400
    {
      const res = await invokePOST({}, 'DEMO');
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /path/i);
      console.log('✓ missing path → 400');
    }

    // `..` traversal → 400
    {
      const res = await invokePOST({ path: '~/.radorc/worktrees/../../etc' }, 'DEMO');
      assert.equal(res.status, 400);
      console.log('✓ `..` traversal → 400');
    }

    // Path outside the allowed roots → 400
    {
      const res = await invokePOST({ path: '~/Downloads/evil' }, 'DEMO');
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /allowed roots/i);
      console.log('✓ outside roots → 400');
    }

    // Valid worktree path → 200 success:true
    {
      const res = await invokePOST({ path: '~/.radorc/worktrees/DEMO/repo' }, 'DEMO');
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      console.log('✓ valid worktree path → 200 success:true');
    }

    // Forced open failure → 500, structured error, no path leakage
    {
      process.env.OPEN_FOLDER_FORCE_FAIL = '1';
      const res = await invokePOST({ path: '~/.radorc/worktrees/DEMO/repo' }, 'DEMO');
      delete process.env.OPEN_FOLDER_FORCE_FAIL;
      assert.equal(res.status, 500);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(typeof json.error, 'string');
      assert.ok(!/[A-Z]:\\|\/home\//.test(json.error), 'error must not echo absolute host path');
      console.log('✓ forced failure → 500, no path leakage');
    }

    console.log('\nAll open-folder route tests passed');
  } finally {
    await teardown();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
