import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { NextRequest } from 'next/server';
import { withHomedir } from '../../../../../../lib/test-helpers.js';
import { POST } from './route.js';

type HeaderOverrides = Record<string, string | null>;

function buildHeaders(overrides?: HeaderOverrides): Headers {
  const headers = new Headers();
  headers.set('sec-fetch-site', 'same-origin');
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) headers.delete(key);
      else headers.set(key, value);
    }
  }
  return headers;
}

const FAKE_REQUEST_URL = 'http://localhost/api/projects/PROJECT-X/debrief/launch';

function fakeRequest(body: unknown = { harness: 'claude' }, headerOverrides?: HeaderOverrides): NextRequest {
  return {
    json: async () => body,
    headers: buildHeaders(headerOverrides),
    nextUrl: new URL(FAKE_REQUEST_URL),
  } as unknown as NextRequest;
}

const FAKE_CLI_PATH = '/fake/install/skills/rad-orchestration/scripts/radorch.mjs';
const ORIGINAL_CLI_PATH = process.env.RADORCH_CLI_PATH;

beforeEach(() => {
  process.env.RADORCH_CLI_PATH = FAKE_CLI_PATH;
});

afterEach(() => {
  mock.restoreAll();
  if (ORIGINAL_CLI_PATH === undefined) delete process.env.RADORCH_CLI_PATH;
  else process.env.RADORCH_CLI_PATH = ORIGINAL_CLI_PATH;
});

interface SpawnRecord {
  cmd: string;
  args: string[];
}

/** Intercepts the real `child_process.spawn` so no test spawns a real terminal. */
function stubSpawn(): { calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = [];
  mock.method(child_process, 'spawn', (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {};
    return child as unknown as child_process.ChildProcess;
  });
  return { calls };
}

/** Every spawn attempt throws, the failure mode a missing terminal binary takes —
 *  `launchTerminal` maps it to `ok: false` rather than propagating. */
function stubThrowingSpawn(message: string): void {
  mock.method(child_process, 'spawn', () => { throw new Error(message); });
}

/**
 * Decodes the inner command the library built, keyed off the host's actual
 * platform (the route never overrides `launchTerminal`'s platform option).
 * Mirrors the decode idiom in
 * app/api/projects/[name]/sessions/[sessionId]/launch/route.test.ts.
 */
function deliveredPayload(calls: SpawnRecord[], index = 0): string {
  const args = calls[index]!.args;
  const platform = process.platform;
  if (platform === 'win32') {
    const idx = args.indexOf('-EncodedCommand');
    if (idx === -1) return '';
    const encoded = args[idx + 1] ?? '';
    return Buffer.from(encoded, 'base64').toString('utf16le');
  }
  if (platform === 'darwin') {
    const idx = args.indexOf('-e');
    return args[idx + 1] ?? '';
  }
  const dashDash = args.indexOf('--');
  const cIdx = args.indexOf('-c', dashDash);
  return args[cIdx + 1] ?? '';
}

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

/**
 * A stubbed homedir carrying the real work-graph registry and project tree
 * `detectPortfolio` now reads membership out of. Supplying `workGraph` also seeds
 * `PORTFOLIO-ROOT/PORTFOLIO-ROOT.md`, without which no group resolves to a
 * portfolio at all.
 */
async function seedHome(opts: { workGraph?: string } = {}): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'debrief-launch-route-'));
  const projectsDir = path.join(home, '.radorc', 'projects');
  await mkdir(path.join(projectsDir, 'PROJECT-X'), { recursive: true });
  if (opts.workGraph !== undefined) {
    const rootDir = path.join(projectsDir, 'PORTFOLIO-ROOT');
    await mkdir(rootDir, { recursive: true });
    await writeFile(path.join(rootDir, 'PORTFOLIO-ROOT.md'), '---\nstatus: active\n---\nBody\n', 'utf-8');
    await writeFile(path.join(home, '.radorc', 'work-graph.yml'), opts.workGraph, 'utf-8');
  }
  return home;
}

// ── Same-origin guard ────────────────────────────────────────────────────────

test('POST rejects a cross-origin request with 403', async () => {
  const res = await POST(fakeRequest({}, { 'sec-fetch-site': 'cross-site' }), { params: { name: 'PROJECT-X' } });
  assert.equal(res.status, 403);
});

test('POST falls back to a matching Origin header (scheme+host+port) when sec-fetch-site is absent', async () => {
  const home = await seedHome({ workGraph: NON_MEMBER_WORK_GRAPH });
  try {
    await withHomedir(home, async () => {
      const res = await POST(
        fakeRequest({ harness: 'claude' }, { 'sec-fetch-site': null, origin: 'http://localhost' }),
        { params: { name: 'PROJECT-X' } },
      );
      assert.equal(res.status, 404, 'origin fallback passed the same-origin gate and reached portfolio detection');
    });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('POST rejects an Origin header that matches host but not scheme', async () => {
  // FAKE_REQUEST_URL is http://localhost/..., so an https Origin sharing the
  // same host must still fail closed: a web Origin is scheme+host+port, and
  // comparing host alone would incorrectly let this through.
  const res = await POST(
    fakeRequest({}, { 'sec-fetch-site': null, origin: 'https://localhost' }),
    { params: { name: 'PROJECT-X' } },
  );
  assert.equal(res.status, 403);
});

test('POST rejects a cross-host Origin header when sec-fetch-site is absent', async () => {
  const res = await POST(
    fakeRequest({}, { 'sec-fetch-site': null, origin: 'http://evil.example' }),
    { params: { name: 'PROJECT-X' } },
  );
  assert.equal(res.status, 403);
});

test('POST rejects a request with neither sec-fetch-site nor Origin', async () => {
  const res = await POST(
    fakeRequest({}, { 'sec-fetch-site': null }),
    { params: { name: 'PROJECT-X' } },
  );
  assert.equal(res.status, 403);
});

// ── Malformed project name ───────────────────────────────────────────────────

const MALFORMED_NAMES = ['..', '.', 'a/b', 'a\\b', ''];
for (const name of MALFORMED_NAMES) {
  test(`POST rejects malformed project name ${JSON.stringify(name)} with 400`, async () => {
    const res = await POST(fakeRequest(), { params: { name } });
    assert.equal(res.status, 400);
  });
}

// ── Invalid or missing harness ───────────────────────────────────────────────

test('POST rejects a missing harness field with 400', async () => {
  const res = await POST(fakeRequest({}), { params: { name: 'PROJECT-X' } });
  assert.equal(res.status, 400);
});

test('POST rejects an unrecognized harness value with 400', async () => {
  const res = await POST(fakeRequest({ harness: 'not-a-real-harness' }), { params: { name: 'PROJECT-X' } });
  assert.equal(res.status, 400);
});

test('POST rejects an unparseable request body with 400, not a 500', async () => {
  const throwingRequest = {
    json: async () => { throw new Error('malformed body'); },
    headers: buildHeaders(),
    nextUrl: new URL(FAKE_REQUEST_URL),
  } as unknown as NextRequest;
  const res = await POST(throwingRequest, { params: { name: 'PROJECT-X' } });
  assert.equal(res.status, 400);
});

// ── Non-member 404 ────────────────────────────────────────────────────────────

test('POST returns 404 for a project that belongs to no portfolio', async () => {
  const home = await seedHome({ workGraph: NON_MEMBER_WORK_GRAPH });
  const { calls } = stubSpawn();
  try {
    await withHomedir(home, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'PROJECT-X' } });
      assert.equal(res.status, 404);
      assert.equal(calls.length, 0, 'a non-member project must never reach the launcher');
    });
  } finally { await rm(home, { recursive: true, force: true }); }
});

// ── Happy path: both directory branches ──────────────────────────────────────

test('POST launches in the workspace directory plus the projects root when the workspace exists', async () => {
  const home = await seedHome({ workGraph: MEMBER_WORK_GRAPH });
  const workspace = path.join(home, '.radorc', 'worktrees', 'PROJECT-X');
  await mkdir(workspace, { recursive: true });
  const { calls } = stubSpawn();
  try {
    await withHomedir(home, async () => {
      const res = await POST(
        fakeRequest({ harness: 'claude', cwd: '/should/be/ignored', prompt: 'ignored prompt', addDir: '/ignored' }),
        { params: { name: 'PROJECT-X' } },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.launched, true);
      assert.equal(typeof body.platform, 'string');

      assert.equal(calls.length, 1, 'exactly one spawn attempt is fired');
      const payload = deliveredPayload(calls);
      const combined = `${calls[0]!.args.join(' ')} ${payload}`;

      assert.ok(combined.includes(workspace), 'the workspace directory drives the launch');
      const projectsRoot = path.join(home, '.radorc', 'projects');
      assert.ok(combined.includes(projectsRoot), 'the additional directory is the projects root from the workspace branch');
      assert.ok(combined.includes('/rad-portfolio debrief PROJECT-X'), 'the server-composed prompt is used');

      assert.ok(!combined.includes('/should/be/ignored'), 'a body cwd must never reach the launcher');
      assert.ok(!combined.includes('ignored prompt'), 'a body prompt must never reach the launcher');
      assert.ok(!combined.includes('/ignored'), 'a body addDir must never reach the launcher');
    });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('POST launches in the iteration folder plus the portfolio root when no workspace exists', async () => {
  // No worktrees/PROJECT-X directory is created — the workspace branch must fall
  // back to the two folders the resolved portfolio names, both of which are real
  // directories in the fixture (launchTerminal requires cwd to exist).
  const home = await seedHome({ workGraph: MEMBER_WORK_GRAPH });
  const projectsDir = path.join(home, '.radorc', 'projects');
  const iterationDir = path.join(projectsDir, 'PROJECT-X');
  const rootDir = path.join(projectsDir, 'PORTFOLIO-ROOT');
  const { calls } = stubSpawn();
  try {
    await withHomedir(home, async () => {
      const res = await POST(fakeRequest({ harness: 'claude' }), { params: { name: 'PROJECT-X' } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.launched, true);

      assert.equal(calls.length, 1);
      const payload = deliveredPayload(calls);
      const combined = `${calls[0]!.args.join(' ')} ${payload}`;

      assert.ok(combined.includes(iterationDir), 'the iteration folder drives the launch');
      assert.ok(combined.includes(rootDir), 'the additional directory is the portfolio root from the fallback branch');
      assert.ok(combined.includes('/rad-portfolio debrief PROJECT-X'));
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('POST returns 500 with the library error when launchTerminal reports a failure', async () => {
  const home = await seedHome({ workGraph: MEMBER_WORK_GRAPH });
  stubThrowingSpawn('terminal unavailable');
  try {
    await withHomedir(home, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'PROJECT-X' } });
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.match(body.error, /terminal unavailable/);
    });
  } finally { await rm(home, { recursive: true, force: true }); }
});
