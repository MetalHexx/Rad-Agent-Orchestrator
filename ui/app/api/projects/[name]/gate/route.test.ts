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
    limits: { max_retries_per_task: 3 },
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

const PORTFOLIO_ROOT_DOC = '---\nstatus: active\n---\nBody\n';

/**
 * A stubbed homedir holding PROJECT-X's `state.json`, plus whatever work-graph
 * registry the scenario needs. `detectPortfolio` now reads membership straight
 * out of `~/.radorc/`, so a member, a non-member, and a corrupt registry are
 * three different fixtures rather than three different stubbed CLI envelopes.
 */
async function seedHome(opts: { workGraph?: string; portfolioRoot?: boolean } = {}): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'gate-route-test-'));
  const projectsDir = path.join(home, '.radorc', 'projects');
  await mkdir(path.join(projectsDir, 'PROJECT-X'), { recursive: true });
  await writeFile(path.join(projectsDir, 'PROJECT-X', 'state.json'), MINIMAL_V5_STATE, 'utf-8');
  if (opts.workGraph !== undefined) {
    await writeFile(path.join(home, '.radorc', 'work-graph.yml'), opts.workGraph, 'utf-8');
  }
  if (opts.portfolioRoot) {
    const rootDir = path.join(projectsDir, 'PORTFOLIO-ROOT');
    await mkdir(rootDir, { recursive: true });
    await writeFile(path.join(rootDir, 'PORTFOLIO-ROOT.md'), PORTFOLIO_ROOT_DOC, 'utf-8');
  }
  return home;
}

before(async () => {
  tmpDir = await seedHome();
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

// ── Portfolio detection on final_approved ────────────────────────────────────

const MEMBER_WORK_GRAPH = `version: 1
rev: 0
groups:
  "group:portfolio":
    name: Portfolio
    description: The portfolio
edges:
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-ROOT
  - type: contains
    from: "group:portfolio"
    to: PROJECT-X
`;

const NON_MEMBER_WORK_GRAPH = `version: 1
rev: 0
groups:
  "group:portfolio":
    name: Portfolio
    description: The portfolio
edges:
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-ROOT
`;

async function postGate(home: string, event: string): Promise<{ status: number; body: unknown }> {
  let status = 0;
  let body: unknown;
  await withHomedir(home, async () => {
    const req = new NextRequest('http://localhost/api/projects/PROJECT-X/gate', {
      method: 'POST', body: JSON.stringify({ event }),
    });
    const res = await POST(req, { params: Promise.resolve({ name: 'PROJECT-X' }) });
    status = res.status;
    body = await res.json();
  });
  return { status, body };
}

test('gate route reports portfolio membership on a successful final_approved for a member project', async (t) => {
  t.after(() => mock.restoreAll());
  const home = await seedHome({ workGraph: MEMBER_WORK_GRAPH, portfolioRoot: true });
  stubExecFile(JSON.stringify({ ok: true, data: { action: 'final_approved' }, exit_code: 0 }));
  try {
    const { status, body } = await postGate(home, 'final_approved');
    assert.strictEqual(status, 200);
    assert.deepEqual(body, { success: true, action: 'final_approved', portfolio: { name: 'PORTFOLIO' } });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('gate route carries no portfolio key on a successful final_approved for a non-member project', async (t) => {
  t.after(() => mock.restoreAll());
  const home = await seedHome({ workGraph: NON_MEMBER_WORK_GRAPH, portfolioRoot: true });
  stubExecFile(JSON.stringify({ ok: true, data: { action: 'final_approved' }, exit_code: 0 }));
  try {
    const { status, body } = await postGate(home, 'final_approved');
    assert.strictEqual(status, 200);
    assert.deepEqual(body, { success: true, action: 'final_approved' });
    assert.ok(!('portfolio' in (body as object)), 'a non-member response must carry exactly today\'s shape, no portfolio key');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('gate route never carries a portfolio key for plan_approved, even for a portfolio-member project', async (t) => {
  t.after(() => mock.restoreAll());
  // The same fixture the member test above resolves a portfolio from, so an
  // absent portfolio key here can only come from the plan_approved branch.
  const home = await seedHome({ workGraph: MEMBER_WORK_GRAPH, portfolioRoot: true });
  const { calls } = stubExecFile(JSON.stringify({ ok: true, data: { action: 'plan_approved' }, exit_code: 0 }));
  try {
    const { status, body } = await postGate(home, 'plan_approved');
    assert.strictEqual(status, 200);
    assert.deepEqual(body, { success: true, action: 'plan_approved' });
    assert.strictEqual(calls.length, 1, 'only the gate approval itself shells out');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('isolation invariant: a detectPortfolio failure must not turn a landed final_approved into a 500', async (t) => {
  t.after(() => mock.restoreAll());
  // An unparseable work-graph.yml makes the library throw while composing the
  // graph — the hardest failure detectPortfolio has to absorb. The approval has
  // already landed by the time detection runs, so it must come back untouched.
  const home = await seedHome({ workGraph: 'groups: "unterminated\nedges: []\n' });
  stubExecFile(JSON.stringify({ ok: true, data: { action: 'final_approved' }, exit_code: 0 }));
  try {
    const { status, body } = await postGate(home, 'final_approved');
    assert.strictEqual(status, 200, 'a detectPortfolio failure must still return the landed approval');
    assert.deepEqual(body, { success: true, action: 'final_approved' });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('withHomedir restores os.homedir even when fn throws (AD-9)', async () => {
  const original = os.homedir();
  await assert.rejects(
    withHomedir('/tmp/h', async () => { throw new Error('boom'); }),
  );
  assert.strictEqual(os.homedir(), original);
});
