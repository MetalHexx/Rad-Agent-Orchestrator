import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import type { NextRequest } from 'next/server';
import { NdjsonSink, SCHEMA_VERSION, type TelemetryRecord } from '@rad-orchestration/telemetry';
import { withHomedir } from '../../../../../lib/test-helpers.js';
import { projectSessionsPath, type ProjectSessionEntry } from '../../../../../lib/project-sessions-reader.js';
import { GET } from './route.js';

function fakeRequest(): NextRequest {
  return {} as unknown as NextRequest;
}

async function seedHome(): Promise<{ tmp: string; projectsDir: string }> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'sessions-route-'));
  const projectsDir = path.join(tmp, '.radorc', 'projects');
  await mkdir(projectsDir, { recursive: true });
  return { tmp, projectsDir };
}

async function seedSessionsFile(
  projectsDir: string,
  projectName: string,
  entries: ProjectSessionEntry[],
): Promise<void> {
  const projectDir = path.join(projectsDir, projectName);
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    projectSessionsPath(projectDir),
    JSON.stringify({ version: 1, sessions: entries, updatedAt: new Date().toISOString() }),
    'utf8',
  );
}

function rec(id: string, sessionId: string, timestamp: string): TelemetryRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    harness: 'claude-code',
    usageId: id,
    sessionId,
    timestamp,
    model: 'm',
    inputTokens: 1,
    outputTokens: 2,
    source: 'main-agent',
    pointers: { sourceFile: 'f.jsonl', requestId: id },
  };
}

function makeEntry(overrides: Partial<ProjectSessionEntry> & { sessionId: string; cwd: string }): ProjectSessionEntry {
  return {
    name: 'My Session',
    harness: 'claude',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    activity: [],
    ...overrides,
  };
}

async function run(tmp: string, name: string): Promise<{ status: number; body: { sessions: unknown[]; totalActiveTimeMs: number } }> {
  const res = await withHomedirResult(tmp, () => GET(fakeRequest(), { params: { name } }));
  const body = await res.json();
  return { status: res.status, body };
}

// withHomedir's callback signature doesn't return a value, so this wraps it to
// hand back the route's response.
async function withHomedirResult<T>(tmp: string, fn: () => Promise<T>): Promise<T> {
  let result!: T;
  await withHomedir(tmp, async () => { result = await fn(); });
  return result;
}

test('an absent project directory returns 200 with an empty payload', async () => {
  const { tmp } = await seedHome();
  try {
    const { status, body } = await run(tmp, 'GHOST');
    assert.equal(status, 200);
    assert.deepEqual(body, { sessions: [], totalActiveTimeMs: 0 });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('a project directory with no sessions file returns 200 with an empty payload', async () => {
  const { tmp, projectsDir } = await seedHome();
  await mkdir(path.join(projectsDir, 'DEMO'), { recursive: true });
  try {
    const { status, body } = await run(tmp, 'DEMO');
    assert.equal(status, 200);
    assert.deepEqual(body, { sessions: [], totalActiveTimeMs: 0 });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('a malformed sessions file returns 200 with an empty payload', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  await writeFile(projectSessionsPath(projectDir), '{ not valid json', 'utf8');
  try {
    const { status, body } = await run(tmp, 'DEMO');
    assert.equal(status, 200);
    assert.deepEqual(body, { sessions: [], totalActiveTimeMs: 0 });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('sorts sessions newest-first by lastSeenAt, activities newest-first by at, sums active time, and zeroes a session with no telemetry', async () => {
  const { tmp, projectsDir } = await seedHome();
  const older = makeEntry({
    sessionId: 'older',
    cwd: path.join(tmp, 'ws-older'),
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    activity: [
      { type: 'other', description: 'first', at: '2026-01-01T00:00:00.000Z' },
      { type: 'other', description: 'second', at: '2026-01-01T01:00:00.000Z' },
    ],
  });
  const newer = makeEntry({
    sessionId: 'newer',
    cwd: path.join(tmp, 'ws-newer'),
    lastSeenAt: '2026-01-02T00:00:00.000Z',
    activity: [],
  });
  await seedSessionsFile(projectsDir, 'DEMO', [older, newer]);

  // Seed telemetry for `newer` only: two rows 10 minutes apart under the
  // 60-minute active-time gap. `older` has no usage rows at all.
  const telemetryRoot = path.join(tmp, '.radorc', 'telemetry');
  new NdjsonSink({ root: telemetryRoot }).write([
    rec('a', 'newer', '2026-01-02T00:00:00Z'),
    rec('b', 'newer', '2026-01-02T00:10:00Z'),
  ]);

  try {
    const { status, body } = await run(tmp, 'DEMO');
    assert.equal(status, 200);
    assert.equal(body.sessions.length, 2);

    const [first, second] = body.sessions as Array<{
      sessionId: string; cwdLabel: string; activeTimeMs: number;
      activity: Array<{ description: string; at: string }>;
    }>;
    assert.equal(first.sessionId, 'newer', 'the more-recently-seen session sorts first');
    assert.equal(second.sessionId, 'older');

    assert.equal(first.activeTimeMs, 10 * 60_000, 'active time computed from telemetry rows');
    assert.equal(second.activeTimeMs, 0, 'a session with no telemetry rows reports zero active time');
    assert.equal(body.totalActiveTimeMs, 10 * 60_000, 'total sums across every session');

    assert.deepEqual(
      second.activity.map((a) => a.description),
      ['second', 'first'],
      'activities within a session sort newest-first by at',
    );

    assert.equal(first.cwdLabel, path.join('~', 'ws-newer'), 'cwdLabel collapses the (stubbed) home prefix');
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
