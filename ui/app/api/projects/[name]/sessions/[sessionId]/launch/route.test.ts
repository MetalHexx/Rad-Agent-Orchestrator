import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { NextRequest } from 'next/server';
import { withHomedir } from '../../../../../../../lib/test-helpers.js';
import { projectSessionsPath, type ProjectSessionEntry } from '../../../../../../../lib/project-sessions-reader.js';
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

const FAKE_REQUEST_URL = 'http://localhost/api/projects/DEMO/sessions/abc-123/launch';

function fakeRequest(body: unknown = {}, headerOverrides?: HeaderOverrides): NextRequest {
  return {
    json: async () => body,
    headers: buildHeaders(headerOverrides),
    nextUrl: new URL(FAKE_REQUEST_URL),
  } as unknown as NextRequest;
}

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

/**
 * Decodes the inner command the library built, keyed off the host's actual
 * platform (the route never overrides `launchTerminal`'s platform option).
 * Mirrors the decode idiom in lib/terminal-launch/tests/launch.test.ts.
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

async function seedHome(): Promise<{ tmp: string; projectsDir: string }> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'launch-route-'));
  const projectsDir = path.join(tmp, '.radorc', 'projects');
  await mkdir(projectsDir, { recursive: true });
  return { tmp, projectsDir };
}

async function seedSessionsFile(
  projectsDir: string,
  projectName: string,
  entries: ProjectSessionEntry[],
): Promise<string> {
  const projectDir = path.join(projectsDir, projectName);
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    projectSessionsPath(projectDir),
    JSON.stringify({ version: 1, sessions: entries, updatedAt: new Date().toISOString() }),
    'utf8',
  );
  return projectDir;
}

function makeEntry(overrides: Partial<ProjectSessionEntry> & { cwd: string }): ProjectSessionEntry {
  return {
    sessionId: 'abc-123',
    name: 'My Session',
    harness: 'claude',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    activity: [],
    ...overrides,
  };
}

afterEach(() => {
  mock.restoreAll();
});

// ── Same-origin guard ────────────────────────────────────────────────────────

test('POST rejects a cross-origin request with 403', async () => {
  const res = await POST(fakeRequest({}, { 'sec-fetch-site': 'cross-site' }), {
    params: { name: 'DEMO', sessionId: 'abc-123' },
  });
  assert.equal(res.status, 403);
});

// ── Malformed name / session id ──────────────────────────────────────────────

const MALFORMED_NAMES = ['..', '.', 'a/b', 'a\\b', ''];
for (const name of MALFORMED_NAMES) {
  test(`POST rejects malformed project name ${JSON.stringify(name)} with 400`, async () => {
    const res = await POST(fakeRequest(), { params: { name, sessionId: 'abc-123' } });
    assert.equal(res.status, 400);
  });
}

const MALFORMED_SESSION_IDS = ['', 'a b', 'a/b', 'a#b'];
for (const sessionId of MALFORMED_SESSION_IDS) {
  test(`POST rejects malformed session id ${JSON.stringify(sessionId)} with 400`, async () => {
    const res = await POST(fakeRequest(), { params: { name: 'DEMO', sessionId } });
    assert.equal(res.status, 400);
  });
}

// ── 404s ──────────────────────────────────────────────────────────────────────

test('POST returns 404 for an unknown project', async () => {
  const { tmp } = await seedHome();
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'GHOST', sessionId: 'abc-123' } });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.match(body.error, /not found/i);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST returns 404 for an unknown session id within a known project', async () => {
  const { tmp, projectsDir } = await seedHome();
  const workspace = path.join(tmp, 'workspace');
  await mkdir(workspace, { recursive: true });
  await seedSessionsFile(projectsDir, 'DEMO', [makeEntry({ cwd: workspace })]);
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'DEMO', sessionId: 'no-such-session' } });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.match(body.error, /not found/i);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

// ── Invalid recorded cwd ──────────────────────────────────────────────────────

test('POST rejects a recorded entry with a relative cwd, 400', async () => {
  const { tmp, projectsDir } = await seedHome();
  await seedSessionsFile(projectsDir, 'DEMO', [makeEntry({ cwd: 'relative/workspace' })]);
  const { calls } = stubSpawn();
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'DEMO', sessionId: 'abc-123' } });
      assert.equal(res.status, 400);
      assert.equal(calls.length, 0, 'a relative cwd must never reach the launcher');
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST rejects a recorded entry whose cwd carries a `..` segment, 400', async () => {
  const { tmp, projectsDir } = await seedHome();
  // Built by string concatenation, not path.join — path.join would normalize
  // away the literal `..` segment before it ever reached the validator.
  const traversal = `${path.join(tmp, 'workspace')}${path.sep}..${path.sep}escape`;
  await seedSessionsFile(projectsDir, 'DEMO', [makeEntry({ cwd: traversal })]);
  const { calls } = stubSpawn();
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'DEMO', sessionId: 'abc-123' } });
      assert.equal(res.status, 400);
      assert.equal(calls.length, 0, 'a traversal-shaped cwd must never reach the launcher');
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

// ── Invalid recorded harness ──────────────────────────────────────────────────

test('POST rejects a recorded entry with an unrecognized harness, 400', async () => {
  const { tmp, projectsDir } = await seedHome();
  const workspace = path.join(tmp, 'workspace');
  await mkdir(workspace, { recursive: true });
  await seedSessionsFile(projectsDir, 'DEMO', [
    makeEntry({ cwd: workspace, harness: 'not-a-real-harness' as ProjectSessionEntry['harness'] }),
  ]);
  const { calls } = stubSpawn();
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'DEMO', sessionId: 'abc-123' } });
      assert.equal(res.status, 400);
      assert.equal(calls.length, 0, 'an unrecognized harness must never reach the launcher');
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

// ── Library failure surfaces its message ─────────────────────────────────────

test('POST returns 500 with the library error when the recorded directory no longer exists', async () => {
  const { tmp, projectsDir } = await seedHome();
  const missing = path.join(tmp, 'workspace-that-was-deleted');
  await seedSessionsFile(projectsDir, 'DEMO', [makeEntry({ cwd: missing })]);
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'DEMO', sessionId: 'abc-123' } });
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.match(body.error, /no longer exists/);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

// ── Happy path: exactly { agent, cwd, resumeSessionId } reaches launchTerminal ─

test('POST launches the recorded entry with exactly { agent, cwd, resumeSessionId }, ignoring the body entirely', async () => {
  const { tmp, projectsDir } = await seedHome();
  const workspace = path.join(tmp, 'workspace');
  await mkdir(workspace, { recursive: true });
  const entry = makeEntry({ cwd: workspace, harness: 'claude', sessionId: 'session-xyz' });
  await seedSessionsFile(projectsDir, 'DEMO', [entry]);
  const { calls } = stubSpawn();
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(
        fakeRequest({ cwd: '/should/be/ignored', command: 'rm -rf /', args: ['--bad'] }),
        { params: { name: 'DEMO', sessionId: entry.sessionId } },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.launched, true);
      assert.equal(typeof body.platform, 'string');

      assert.equal(calls.length, 1, 'exactly one spawn attempt is fired');
      const payload = deliveredPayload(calls);
      const combined = `${calls[0]!.args.join(' ')} ${payload}`;

      assert.match(combined, /claude/);
      assert.match(combined, new RegExp(entry.sessionId));
      assert.ok(combined.includes(entry.cwd), 'the recorded cwd drives the launch');

      assert.ok(!combined.includes('/should/be/ignored'), 'a body cwd must never reach the launcher');
      assert.ok(!combined.includes('rm -rf'), 'a body command must never reach the launcher');
      assert.ok(!combined.includes('--bad'), 'body args must never reach the launcher');
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST never reads the request body', async () => {
  const { tmp, projectsDir } = await seedHome();
  const workspace = path.join(tmp, 'workspace');
  await mkdir(workspace, { recursive: true });
  const entry = makeEntry({ cwd: workspace });
  await seedSessionsFile(projectsDir, 'DEMO', [entry]);
  stubSpawn();
  try {
    await withHomedir(tmp, async () => {
      const throwingRequest = {
        json: async () => { throw new Error('the launch route must never call request.json()'); },
        headers: buildHeaders(),
        nextUrl: new URL(FAKE_REQUEST_URL),
      } as unknown as NextRequest;
      const res = await POST(throwingRequest, { params: { name: 'DEMO', sessionId: entry.sessionId } });
      assert.equal(res.status, 200);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
