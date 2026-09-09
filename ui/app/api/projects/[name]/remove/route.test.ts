import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import type { NextRequest } from 'next/server';
import type { DeletionReport } from '@rad-orchestration/work-graph';
import { writeProjectIndexEntry, readProjectIndex } from '@rad-orchestration/telemetry';
import { withHomedir } from '../../../../../lib/test-helpers.js';
import { getLiveRuntime, __resetLiveRuntimeForTest } from '../../../../../lib/live/live-hub-runtime.js';
import { getSharedWatcher, __resetSharedWatcherForTest } from '../../../../../lib/live/shared-watcher.js';
import { GET, POST } from './route.js';
import { projectDirWasRemoved } from './project-dir-removed.js';

// Every request built by fakeRequest()/jsonRequest() defaults to
// `sec-fetch-site: same-origin` so all the pre-existing tests below keep
// passing unmodified now that POST checks it. Pass overrides (a value of
// `null` deletes the default) to drive the cross-origin tests.
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

// A fixed host so Origin-based tests can assert a match/mismatch deterministically.
const FAKE_REQUEST_URL = 'http://localhost/api/projects/DEMO/remove';

function fakeRequest(headerOverrides?: HeaderOverrides): NextRequest {
  return {
    json: async () => ({}),
    headers: buildHeaders(headerOverrides),
    nextUrl: new URL(FAKE_REQUEST_URL),
  } as unknown as NextRequest;
}

// Deliberately invalid YAML (tab indentation) so GraphIndex.read() throws when
// deleteProject composes its plan — used to drive the delete-throws path
// without stubbing anything inside the library.
const MALFORMED_WORK_GRAPH_YML = 'root:\n\t- bad\n';

function spyWatcher() {
  const e = new EventEmitter() as EventEmitter & { close: () => Promise<void>; closeCount: number };
  e.closeCount = 0;
  e.close = async () => { e.closeCount += 1; };
  return e;
}

function watcherFactory() {
  const created: Array<ReturnType<typeof spyWatcher>> = [];
  return { created, make: () => { const w = spyWatcher(); created.push(w); return w as never; } };
}

// Mirrors the manualClock idiom in live-hub-runtime.test.ts: hub delivery is
// never synchronous (topic-hub schedules via the injected scheduler even at
// coalesceWindowMs: 0), so a test asserting on a publish must flush this
// manually rather than counting deliveries immediately after `await POST(...)`.
function manualClock() {
  let pending: Array<() => void> = [];
  return {
    schedule: (cb: () => void) => { pending.push(cb); return pending.length; },
    cancel: () => {},
    flush: () => { const p = pending; pending = []; p.forEach((c) => c()); },
  };
}

function jsonRequest(body: unknown, headerOverrides?: HeaderOverrides): NextRequest {
  return {
    json: async () => body,
    headers: buildHeaders(headerOverrides),
    nextUrl: new URL(FAKE_REQUEST_URL),
  } as unknown as NextRequest;
}

async function seedHome(): Promise<{ tmp: string; projectsDir: string }> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'remove-route-'));
  const projectsDir = path.join(tmp, '.radorc', 'projects');
  await mkdir(projectsDir, { recursive: true });
  return { tmp, projectsDir };
}

// Seeds a 'DEMO' project whose source_control names two repos: one bound
// in-place to a registry local path (resolves 'protected', carrying the full
// clone path in both `path` and the protectedReason prose) and one plain
// worktree (removable, and the target of the skip tests). Both repo
// directories are pre-created on disk so deletion attempts (or their absence,
// under skip) are observable via stat().
async function seedProjectWithRepos(): Promise<{
  tmp: string; projectsDir: string; clonePath: string; worktreePath: string;
}> {
  const { tmp, projectsDir } = await seedHome();
  const registryRoot = path.join(tmp, '.radorc');
  const worktreesDir = path.join(registryRoot, 'worktrees');
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });

  const clonePath = path.join(registryRoot, 'clones', 'protected-repo');
  await mkdir(clonePath, { recursive: true });

  const worktreePath = path.join(worktreesDir, 'DEMO', 'plain-repo');
  await mkdir(worktreePath, { recursive: true });

  const state = {
    pipeline: {
      source_control: {
        repos: [
          { name: 'protected-repo', in_place: true },
          { name: 'plain-repo' },
        ],
      },
    },
  };
  await writeFile(path.join(projectDir, 'state.json'), JSON.stringify(state), 'utf-8');
  await writeFile(
    path.join(registryRoot, 'repo-registry.local.yml'),
    `paths:\n  protected-repo: ${JSON.stringify(clonePath)}\n`,
    'utf-8',
  );

  return { tmp, projectsDir, clonePath, worktreePath };
}

const MALFORMED_NAMES = ['..', 'a/b', 'a\\b', '.', '', 'C:\\Windows'];

for (const name of MALFORMED_NAMES) {
  test(`GET rejects malformed name ${JSON.stringify(name)} with 400`, async () => {
    const res = await GET(fakeRequest(), { params: { name } });
    assert.equal(res.status, 400);
  });

  test(`POST rejects malformed name ${JSON.stringify(name)} with 400`, async () => {
    const res = await POST(fakeRequest(), { params: { name } });
    assert.equal(res.status, 400);
  });
}

test('GET returns 404 for an unknown project', async () => {
  const { tmp } = await seedHome();
  try {
    await withHomedir(tmp, async () => {
      const res = await GET(fakeRequest(), { params: { name: 'GHOST' } });
      assert.equal(res.status, 404);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('GET returns the plan and leaves the project on disk (preview mutates nothing)', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  try {
    await withHomedir(tmp, async () => {
      const res = await GET(fakeRequest(), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.plan.project, 'DEMO');
      assert.ok(Array.isArray(body.plan.items));
      await stat(projectDir); // still present — GET must not delete anything
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST removes the project and returns a complete report', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.report.project, 'DEMO');
      assert.equal(body.report.complete, true);
      await assert.rejects(() => stat(projectDir), 'project directory must be removed');
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST returns 404 for a project id that was never found, matching GET', async () => {
  const { tmp } = await seedHome();
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'GHOST' } });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.match(body.error, /GHOST/);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST resumes both watchers on the success path', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  __resetLiveRuntimeForTest();
  __resetSharedWatcherForTest();
  const liveFactory = watcherFactory();
  const sharedFactory = watcherFactory();
  try {
    await withHomedir(tmp, async () => {
      getLiveRuntime({ projectsRoot: projectsDir, makeWatcher: liveFactory.make, coalesceWindowMs: 0 });
      const shared = getSharedWatcher({ projectsRoot: projectsDir, makeWatcher: sharedFactory.make });
      const off = shared.subscribe(() => {});
      assert.equal(liveFactory.created.length, 1);
      assert.equal(sharedFactory.created.length, 1);

      const res = await POST(fakeRequest(), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);

      assert.equal(liveFactory.created[0]!.closeCount, 1, 'the outgoing projects watcher was closed before the delete');
      assert.equal(liveFactory.created.length, 2, 'the projects watcher was reopened after the delete');
      assert.equal(sharedFactory.created[0]!.closeCount, 1, 'the outgoing shared watcher was closed before the delete');
      assert.equal(sharedFactory.created.length, 2, 'the shared watcher was reopened after the delete');
      off();
    });
  } finally {
    __resetLiveRuntimeForTest();
    __resetSharedWatcherForTest();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('POST resumes both watchers even when the delete itself throws', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  // Corrupt work-graph.yml so deleteProject's plan composition throws.
  await writeFile(path.join(tmp, '.radorc', 'work-graph.yml'), MALFORMED_WORK_GRAPH_YML, 'utf-8');
  __resetLiveRuntimeForTest();
  __resetSharedWatcherForTest();
  const liveFactory = watcherFactory();
  const sharedFactory = watcherFactory();
  try {
    await withHomedir(tmp, async () => {
      getLiveRuntime({ projectsRoot: projectsDir, makeWatcher: liveFactory.make, coalesceWindowMs: 0 });
      const shared = getSharedWatcher({ projectsRoot: projectsDir, makeWatcher: sharedFactory.make });
      const off = shared.subscribe(() => {});

      const res = await POST(fakeRequest(), { params: { name: 'DEMO' } });
      assert.equal(res.status, 500);

      assert.equal(liveFactory.created[0]!.closeCount, 1, 'the outgoing projects watcher was closed even though the delete threw');
      assert.equal(liveFactory.created.length, 2, 'the projects watcher was reopened even though the delete threw');
      assert.equal(sharedFactory.created[0]!.closeCount, 1, 'the outgoing shared watcher was closed even though the delete threw');
      assert.equal(sharedFactory.created.length, 2, 'the shared watcher was reopened even though the delete threw');
      off();
    });
  } finally {
    __resetLiveRuntimeForTest();
    __resetSharedWatcherForTest();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('GET home-relatives every item path and the protectedReason prose, leaving graph-edges null', async () => {
  const { tmp, clonePath, worktreePath } = await seedProjectWithRepos();
  try {
    await withHomedir(tmp, async () => {
      const res = await GET(fakeRequest(), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      const body = await res.json();
      const items = body.plan.items as Array<{ kind: string; label: string; path: string | null; protectedReason?: string }>;

      const projectDirItem = items.find((i) => i.kind === 'project-dir')!;
      assert.equal(projectDirItem.path, path.join('~', '.radorc', 'projects', 'DEMO'));

      const graphEdgesItem = items.find((i) => i.kind === 'graph-edges')!;
      assert.equal(graphEdgesItem.path, null);

      const protectedItem = items.find((i) => i.label === 'protected-repo')!;
      const expectedClone = path.join('~', path.relative(tmp, clonePath));
      assert.equal(protectedItem.path, expectedClone);
      assert.ok(protectedItem.protectedReason?.includes(expectedClone), 'protectedReason prose collapses the home directory too');
      assert.ok(!protectedItem.protectedReason?.includes(tmp), 'the full unresolved home path must not appear twice on one row');

      const worktreeItem = items.find((i) => i.label === 'plain-repo')!;
      assert.equal(worktreeItem.path, path.join('~', path.relative(tmp, worktreePath)));
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST with a skip selection leaves the skipped worktree on disk, reports it skipped, and home-relatives every path', async () => {
  const { tmp, clonePath, worktreePath } = await seedProjectWithRepos();
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(jsonRequest({ skip: [{ kind: 'worktree', label: 'plain-repo' }] }), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.report.complete, true);

      const items = body.report.items as Array<{ kind: string; label: string; path: string | null; outcome: string; protectedReason?: string }>;
      const skipped = items.find((i) => i.label === 'plain-repo')!;
      assert.equal(skipped.outcome, 'skipped');
      assert.equal(skipped.path, path.join('~', path.relative(tmp, worktreePath)));
      await stat(worktreePath); // still on disk — the skip was honoured

      const protectedItem = items.find((i) => i.label === 'protected-repo')!;
      assert.equal(protectedItem.outcome, 'protected');
      const expectedClone = path.join('~', path.relative(tmp, clonePath));
      assert.equal(protectedItem.path, expectedClone);
      assert.ok(protectedItem.protectedReason?.includes(expectedClone));
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST with a skip entry naming a structurally-mandatory kind returns 400', async () => {
  const res = await POST(jsonRequest({ skip: [{ kind: 'project-dir', label: 'X' }] }), { params: { name: 'DEMO' } });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'Invalid skip selection');
});

test('POST with a skip entry naming an unrecognised kind returns 400', async () => {
  const res = await POST(jsonRequest({ skip: [{ kind: 'graph-edges', label: 'X' }] }), { params: { name: 'DEMO' } });
  assert.equal(res.status, 400);
});

test('POST with a non-array skip field returns 400', async () => {
  const res = await POST(jsonRequest({ skip: 'worktree' }), { params: { name: 'DEMO' } });
  assert.equal(res.status, 400);
});

test('POST with a non-object skip entry returns 400', async () => {
  const res = await POST(jsonRequest({ skip: ['worktree'] }), { params: { name: 'DEMO' } });
  assert.equal(res.status, 400);
});

test('POST with a skip entry missing a non-empty label returns 400', async () => {
  const res = await POST(jsonRequest({ skip: [{ kind: 'worktree', label: '' }] }), { params: { name: 'DEMO' } });
  assert.equal(res.status, 400);
});

test('POST treats an unparseable JSON body as no selection, exactly as a missing body would', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  try {
    await withHomedir(tmp, async () => {
      const badBody = {
        json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
        headers: buildHeaders(),
        nextUrl: new URL(FAKE_REQUEST_URL),
      } as unknown as NextRequest;
      const res = await POST(badBody, { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST publishes exactly one project_removed notification on a complete success', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  __resetLiveRuntimeForTest();
  const clock = manualClock();
  const liveFactory = watcherFactory();
  try {
    await withHomedir(tmp, async () => {
      const rt = getLiveRuntime({ projectsRoot: projectsDir, makeWatcher: liveFactory.make, coalesceWindowMs: 0, scheduler: clock });
      const notifs: Array<{ payload: { projectName: string } }> = [];
      const off = rt.subscribeLifecycle((n) => { if (n.type === 'project_removed') notifs.push(n); });

      const res = await POST(fakeRequest(), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      clock.flush();

      assert.equal(notifs.length, 1);
      assert.equal(notifs[0].payload.projectName, 'DEMO');
      off();
    });
  } finally {
    __resetLiveRuntimeForTest();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('POST does not publish project_removed for a 404 (nothing was ever found)', async () => {
  const { tmp, projectsDir } = await seedHome();
  __resetLiveRuntimeForTest();
  const clock = manualClock();
  const liveFactory = watcherFactory();
  try {
    await withHomedir(tmp, async () => {
      const rt = getLiveRuntime({ projectsRoot: projectsDir, makeWatcher: liveFactory.make, coalesceWindowMs: 0, scheduler: clock });
      const notifs: unknown[] = [];
      const off = rt.subscribeLifecycle((n) => { if (n.type === 'project_removed') notifs.push(n); });

      const res = await POST(fakeRequest(), { params: { name: 'GHOST' } });
      assert.equal(res.status, 404);
      clock.flush();

      assert.equal(notifs.length, 0);
      off();
    });
  } finally {
    __resetLiveRuntimeForTest();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('POST does not publish project_removed when the report is incomplete', async () => {
  const { tmp, projectsDir } = await seedProjectWithRepos();
  __resetLiveRuntimeForTest();
  const clock = manualClock();
  const liveFactory = watcherFactory();
  try {
    await withHomedir(tmp, async () => {
      const rt = getLiveRuntime({ projectsRoot: projectsDir, makeWatcher: liveFactory.make, coalesceWindowMs: 0, scheduler: clock });
      const notifs: unknown[] = [];
      const off = rt.subscribeLifecycle((n) => { if (n.type === 'project_removed') notifs.push(n); });

      // No skip: 'plain-repo' has no registry-clone binding and is not a real
      // git worktree, so its removal fails, holding back project-dir and
      // graph-edges and leaving the report incomplete.
      const res = await POST(fakeRequest(), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.report.complete, false);
      clock.flush();

      assert.equal(notifs.length, 0);
      off();
    });
  } finally {
    __resetLiveRuntimeForTest();
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Telemetry claim removal: fires in the same gate as publishProjectRemoved
// (project-dir came back 'removed'), and must not fire when the delete left
// the project directory behind (held back by an unresolved sibling item).
// ---------------------------------------------------------------------------

test('POST clears the removed project\'s telemetry index claims, leaving other projects\' claims intact', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  const telemetryRoot = path.join(tmp, '.radorc', 'telemetry');
  writeProjectIndexEntry(telemetryRoot, { sessionId: 's1', project: 'DEMO' });
  writeProjectIndexEntry(telemetryRoot, { sessionId: 's2', project: 'OTHER' });
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(fakeRequest(), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);

      const index = readProjectIndex(telemetryRoot);
      assert.deepEqual(index.sessions.map((s) => s.sessionId), ['s2']);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST leaves telemetry claims intact when the report is incomplete (project-dir held back)', async () => {
  const { tmp } = await seedProjectWithRepos();
  const telemetryRoot = path.join(tmp, '.radorc', 'telemetry');
  writeProjectIndexEntry(telemetryRoot, { sessionId: 's1', project: 'DEMO' });
  try {
    await withHomedir(tmp, async () => {
      // No skip: 'plain-repo' fails to remove, holding back project-dir — see
      // the identical setup in the 'does not publish project_removed' test above.
      const res = await POST(fakeRequest(), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.report.complete, false);

      assert.deepEqual(readProjectIndex(telemetryRoot).sessions.map((s) => s.sessionId), ['s1']);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// projectDirWasRemoved (Fix 2): the guard now keys off project-dir's own item
// outcome, not the report's overall `complete` flag, so a later item (e.g.
// graph-edges) failing AFTER project-dir is already gone still fires the
// lifecycle notification. Exercised directly against hand-built fixtures —
// engineering a real stale-revision race through the full HTTP handler isn't
// necessary since the predicate is pure.
// ---------------------------------------------------------------------------

test('projectDirWasRemoved is true when project-dir was removed even though the overall report is incomplete', () => {
  const report: DeletionReport = {
    project: 'DEMO',
    complete: false,
    items: [
      { kind: 'worktree', label: 'plain-repo', path: '/tmp/plain-repo', exists: true, disposition: 'remove', outcome: 'failed', error: 'boom' },
      { kind: 'project-dir', label: 'DEMO', path: '/tmp/projects/DEMO', exists: true, disposition: 'remove', outcome: 'removed' },
      { kind: 'graph-edges', label: 'DEMO', path: null, exists: true, disposition: 'remove', outcome: 'held-back', error: 'blocked by plain-repo' },
    ],
  };
  assert.equal(projectDirWasRemoved(report), true);
});

test('projectDirWasRemoved is true on a fully complete report (superset of the old condition)', () => {
  const report: DeletionReport = {
    project: 'DEMO',
    complete: true,
    items: [
      { kind: 'project-dir', label: 'DEMO', path: '/tmp/projects/DEMO', exists: true, disposition: 'remove', outcome: 'removed' },
      { kind: 'graph-edges', label: 'DEMO', path: null, exists: true, disposition: 'remove', outcome: 'removed' },
    ],
  };
  assert.equal(projectDirWasRemoved(report), true);
});

test('projectDirWasRemoved is false when project-dir itself was never removed', () => {
  const report: DeletionReport = {
    project: 'DEMO',
    complete: false,
    items: [
      { kind: 'worktree', label: 'plain-repo', path: '/tmp/plain-repo', exists: true, disposition: 'remove', outcome: 'failed', error: 'boom' },
      { kind: 'project-dir', label: 'DEMO', path: '/tmp/projects/DEMO', exists: true, disposition: 'remove', outcome: 'held-back', error: 'blocked by plain-repo' },
      { kind: 'graph-edges', label: 'DEMO', path: null, exists: true, disposition: 'remove', outcome: 'held-back', error: 'blocked by plain-repo' },
    ],
  };
  assert.equal(projectDirWasRemoved(report), false);
});

// ---------------------------------------------------------------------------
// Same-origin guard (Fix 3): POST now rejects any request that doesn't carry
// same-origin proof, checked before the name-validity check. GET (the
// read-only preview) is unaffected.
// ---------------------------------------------------------------------------

test('POST rejects a cross-site request (sec-fetch-site: cross-site) with 403', async () => {
  const res = await POST(fakeRequest({ 'sec-fetch-site': 'cross-site' }), { params: { name: 'DEMO' } });
  assert.equal(res.status, 403);
});

test('POST rejects a same-site (but not same-origin) request (sec-fetch-site: same-site) with 403', async () => {
  const res = await POST(fakeRequest({ 'sec-fetch-site': 'same-site' }), { params: { name: 'DEMO' } });
  assert.equal(res.status, 403);
});

test('POST rejects when Origin host does not match the request host, with 403', async () => {
  const res = await POST(
    fakeRequest({ 'sec-fetch-site': null, origin: 'http://evil.example.com' }),
    { params: { name: 'DEMO' } },
  );
  assert.equal(res.status, 403);
});

test('POST rejects when neither sec-fetch-site nor Origin is present (fail-closed default)', async () => {
  const res = await POST(fakeRequest({ 'sec-fetch-site': null }), { params: { name: 'DEMO' } });
  assert.equal(res.status, 403);
});

test('POST accepts sec-fetch-site: same-origin', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(fakeRequest({ 'sec-fetch-site': 'same-origin' }), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('POST accepts when Origin matches the request host and sec-fetch-site is absent', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  try {
    await withHomedir(tmp, async () => {
      const res = await POST(
        fakeRequest({ 'sec-fetch-site': null, origin: 'http://localhost' }),
        { params: { name: 'DEMO' } },
      );
      assert.equal(res.status, 200);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Overlapping-POST serialization (Fix 1): a second concurrent POST must not
// begin suspending/closing watchers until the first request's `finally`
// (resume) has fully completed. Gives the FIRST created watcher a deferred
// close() so the test can observe exactly how far each request has
// progressed before manually releasing it.
// ---------------------------------------------------------------------------

function loggingWatcherFactory(events: string[]) {
  const created: Array<ReturnType<typeof spyWatcher>> = [];
  let resolveFirstClose: (() => void) | null = null;
  const make = () => {
    const index = created.length;
    events.push(`create-${index}`);
    const w = spyWatcher();
    const originalClose = w.close;
    w.close = async () => {
      events.push(`close-start-${index}`);
      if (index === 0) {
        await new Promise<void>((resolve) => { resolveFirstClose = resolve; });
      }
      await originalClose();
      events.push(`close-end-${index}`);
    };
    created.push(w);
    return w as never;
  };
  return {
    created,
    make,
    releaseFirstClose: () => { resolveFirstClose?.(); resolveFirstClose = null; },
  };
}

test('two overlapping POSTs serialize: the second never begins suspending until the first has fully resumed', async () => {
  const { tmp, projectsDir } = await seedHome();
  const projectDir = path.join(projectsDir, 'DEMO');
  await mkdir(projectDir, { recursive: true });
  __resetLiveRuntimeForTest();
  __resetSharedWatcherForTest();

  const events: string[] = [];
  const liveFactory = loggingWatcherFactory(events);

  try {
    await withHomedir(tmp, async () => {
      getLiveRuntime({ projectsRoot: projectsDir, makeWatcher: liveFactory.make, coalesceWindowMs: 0 });
      assert.deepEqual(events, ['create-0']);

      const p1 = POST(fakeRequest(), { params: { name: 'DEMO' } });
      const p2 = POST(fakeRequest(), { params: { name: 'DEMO' } });

      // Flush microtasks so request 1 reaches (and blocks on) watcher 0's
      // deferred close, and request 2 finishes its own name/skip validation
      // and enqueues behind `inFlight` — but must not progress any further.
      for (let i = 0; i < 20; i += 1) await Promise.resolve();

      assert.ok(events.includes('close-start-0'), 'request 1 should have begun closing the initial watcher');
      assert.ok(!events.some((e) => e.startsWith('create-1')), 'request 2 must not have created a resumed/second watcher yet');
      assert.ok(!events.some((e) => e.startsWith('close-start-1')), 'request 2 must not have begun its own suspend yet');

      liveFactory.releaseFirstClose();
      const [res1, res2] = await Promise.all([p1, p2]);

      // The first request actually deleted the project; the second finds it
      // already gone — confirming the two runs executed one at a time rather
      // than interleaved against a half-deleted directory.
      assert.equal(res1.status, 200);
      assert.equal(res2.status, 404);

      // Strict lockstep: watcher 0 fully closes, THEN watcher 1 (request 1's
      // resume) is created and fully closes (request 2's suspend), THEN
      // watcher 2 (request 2's resume) is created — never interleaved.
      const idx = (label: string) => events.indexOf(label);
      assert.ok(idx('close-end-0') < idx('create-1'), 'watcher 0 must finish closing before the resumed watcher 1 is created');
      assert.ok(idx('create-1') < idx('close-start-1'), 'watcher 1 must exist before request 2 starts suspending it');
      assert.ok(idx('close-end-1') < idx('create-2'), 'watcher 1 must finish closing before request 2 resumes into watcher 2');
    });
  } finally {
    __resetLiveRuntimeForTest();
    __resetSharedWatcherForTest();
    await rm(tmp, { recursive: true, force: true });
  }
});
