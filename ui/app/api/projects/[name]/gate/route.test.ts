import { test, mock, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import child_process from 'node:child_process';
import { NextRequest } from 'next/server';
import { withHomedir } from '../../../../../lib/test-helpers.js';
import { POST } from './route.js';

// Minimal v5 state fixture so readProjectState returns non-null (not 404)
const MINIMAL_V5_STATE = JSON.stringify({
  $schema: 'orchestration-state-v5',
  project: { name: 'PROJECT-X', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
    source_control: { auto_commit: 'always', auto_pr: 'never' },
  },
  pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
  graph: {
    template_id: 'extra-high', status: 'in_progress', current_node_path: 'phase_loop',
    nodes: {
      master_plan: { kind: 'step', status: 'completed', doc_path: 'reports/MASTER-PLAN.md', retries: 0 },
      phase_loop: { kind: 'for_each_phase', status: 'in_progress', iterations: [] },
    },
  },
});

let tmpDir = '';
const FAKE_CLI_PATH = '/fake/install/skills/rad-orchestration/scripts/radorch.mjs';
const ORIGINAL_CLI_PATH = process.env.RADORCH_CLI_PATH;

before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'gate-route-test-'));
  const projectDir = path.join(tmpDir, '.radorc', 'projects', 'PROJECT-X');
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, 'state.json'), MINIMAL_V5_STATE, 'utf-8');
});

after(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.RADORCH_CLI_PATH = FAKE_CLI_PATH;
});

afterEach(() => {
  if (ORIGINAL_CLI_PATH === undefined) delete process.env.RADORCH_CLI_PATH;
  else process.env.RADORCH_CLI_PATH = ORIGINAL_CLI_PATH;
});

function stubExecFile(stdout: string, exitCode = 0): { calls: Array<{ file: string; args: string[] }> } {
  const calls: Array<{ file: string; args: string[] }> = [];
  mock.method(child_process, 'execFile', (file: string, args: string[], _opts: unknown, cb: (...cbArgs: unknown[]) => void) => {
    calls.push({ file, args });
    // Node's execFile callback is (error, stdout, stderr) — three positional args.
    if (exitCode === 0) cb(null, stdout, '');
    else {
      const err: NodeJS.ErrnoException & { stdout?: string; stderr?: string } = new Error('nonzero');
      err.stdout = stdout; err.stderr = '';
      cb(err, stdout, '');
    }
    return { } as never;
  });
  return { calls };
}

test('gate route shells out to RADORCH_CLI_PATH (FR-14, AD-8)', async (t) => {
  t.after(() => mock.restoreAll());
  const { calls } = stubExecFile(JSON.stringify({ ok: true, data: { action: 'plan_approved' }, exit_code: 0 }));
  await withHomedir(tmpDir, async () => {
    const req = new NextRequest('http://localhost/api/projects/PROJECT-X/gate', {
      method: 'POST', body: JSON.stringify({ event: 'plan_approved' }),
    });
    const res = await POST(req, { params: Promise.resolve({ name: 'PROJECT-X' }) });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { success: true, action: 'plan_approved' });
    assert.ok(!('mutations_applied' in body), 'response should not carry mutations_applied');
  });
  assert.strictEqual(calls.length, 1);
  const { file, args } = calls[0];
  // execFile is invoked with process.execPath (node) as the program.
  assert.ok(file === process.execPath || file === 'node', `unexpected exec program: ${file}`);
  assert.strictEqual(args[0], FAKE_CLI_PATH, `argv[0] should be RADORCH_CLI_PATH: ${args[0]}`);
  assert.deepEqual(args.slice(1, 5), ['gate', 'approve', 'plan', '--project-dir']);
  assert.ok(args[5] && args[5].endsWith('PROJECT-X'), `--project-dir target should resolve PROJECT-X: ${args[5]}`);
});

test('gate route returns 409 when CLI envelope rejects the event (DD-4)', async (t) => {
  t.after(() => mock.restoreAll());
  stubExecFile(JSON.stringify({ ok: false, data: { event: 'plan_approved' }, error: { type: 'user_error', message: 'wrong gate' }, exit_code: 1 }), 1);
  await withHomedir(tmpDir, async () => {
    const req = new NextRequest('http://localhost/api/projects/PROJECT-X/gate', {
      method: 'POST', body: JSON.stringify({ event: 'plan_approved' }),
    });
    const res = await POST(req, { params: Promise.resolve({ name: 'PROJECT-X' }) });
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.match(JSON.stringify(body), /wrong gate/);
  });
});

test('gate route returns 500 when CLI envelope reports a system_error (DD-4)', async (t) => {
  t.after(() => mock.restoreAll());
  stubExecFile(JSON.stringify({ ok: false, data: { event: 'plan_approved' }, error: { type: 'system_error', message: 'engine crashed' }, exit_code: 1 }), 1);
  await withHomedir(tmpDir, async () => {
    const req = new NextRequest('http://localhost/api/projects/PROJECT-X/gate', {
      method: 'POST', body: JSON.stringify({ event: 'plan_approved' }),
    });
    const res = await POST(req, { params: Promise.resolve({ name: 'PROJECT-X' }) });
    assert.strictEqual(res.status, 500);
    const body = await res.json();
    assert.match(JSON.stringify(body), /engine crashed/);
  });
});

test('gate route returns 500 when CLI stdout is unparseable (DD-4)', async (t) => {
  t.after(() => mock.restoreAll());
  stubExecFile('not json', 1);
  await withHomedir(tmpDir, async () => {
    const req = new NextRequest('http://localhost/api/projects/PROJECT-X/gate', {
      method: 'POST', body: JSON.stringify({ event: 'plan_approved' }),
    });
    const res = await POST(req, { params: Promise.resolve({ name: 'PROJECT-X' }) });
    assert.strictEqual(res.status, 500);
  });
});

test('gate route returns 500 with clear error when RADORCH_CLI_PATH is missing', async () => {
  delete process.env.RADORCH_CLI_PATH;
  await withHomedir(tmpDir, async () => {
    const req = new NextRequest('http://localhost/api/projects/PROJECT-X/gate', {
      method: 'POST', body: JSON.stringify({ event: 'plan_approved' }),
    });
    const res = await POST(req, { params: Promise.resolve({ name: 'PROJECT-X' }) });
    assert.strictEqual(res.status, 500);
    const body = await res.json();
    assert.match(JSON.stringify(body), /RADORCH_CLI_PATH/);
  });
});

test('withHomedir restores os.homedir even when fn throws (AD-9)', async () => {
  const original = os.homedir();
  await assert.rejects(
    withHomedir('/tmp/h', async () => { throw new Error('boom'); }),
  );
  assert.strictEqual(os.homedir(), original);
});
