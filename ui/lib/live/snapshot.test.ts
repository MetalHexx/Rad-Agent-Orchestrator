import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchArtifactSnapshot, reconcileUnseen, diffSnapshots } from './snapshot';

test('snapshot pulls the file list over REST and derives the established set (FR-12, FR-5, AD-10)', async () => {
  const fakeFetch = async (url: string) => {
    assert.match(url, /\/api\/projects\/DEMO\/files$/);
    return { ok: true, json: async () => ({ files: ['DEMO-BRAINSTORMING.md', 'DEMO-BRAINSTORM.html'], mtimes: {} }) } as Response;
  };
  const snap = await fetchArtifactSnapshot('DEMO', fakeFetch as typeof fetch);
  assert.deepEqual(snap.artifacts.map((a) => a.fileName), ['DEMO-BRAINSTORMING.md', 'DEMO-BRAINSTORM.html']);
  assert.deepEqual(snap.files, ['DEMO-BRAINSTORMING.md', 'DEMO-BRAINSTORM.html']);
});

test('snapshot resolves to an empty set when the fetch rejects (no unhandled rejection)', async () => {
  const rejectingFetch = async () => { throw new TypeError('network down'); };
  const snap = await fetchArtifactSnapshot('DEMO', rejectingFetch as typeof fetch);
  assert.deepEqual(snap, { ok: false, files: [], artifacts: [], mtimes: {} });
});

test('snapshot resolves to an empty set when the body fails to parse', async () => {
  const badJsonFetch = async () =>
    ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } } as unknown as Response);
  const snap = await fetchArtifactSnapshot('DEMO', badJsonFetch as typeof fetch);
  assert.deepEqual(snap, { ok: false, files: [], artifacts: [], mtimes: {} });
});

test('snapshot flags ok=true on a successful fetch and ok=false on a non-OK response', async () => {
  // ok=true lets the provider trust this snapshot as a diff baseline; a non-OK
  // response (the /files route returns 404/500 on error) must flag ok=false so the
  // provider refuses to store an empty file list as the baseline — otherwise the
  // next successful snapshot would diff every file as `added` and falsely pulse.
  const okFetch = async () =>
    ({ ok: true, json: async () => ({ files: ['A.md'], mtimes: { 'A.md': 1 } }) } as Response);
  const okSnap = await fetchArtifactSnapshot('DEMO', okFetch as typeof fetch);
  assert.equal(okSnap.ok, true);

  const failFetch = async () =>
    ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) } as unknown as Response);
  const failSnap = await fetchArtifactSnapshot('DEMO', failFetch as typeof fetch);
  assert.equal(failSnap.ok, false);
  assert.deepEqual(failSnap.files, [], 'a failed fetch carries no files');
});

test('reconcile drops unseen entries whose files no longer exist (FR-14)', () => {
  const unseen = new Set(['GONE.html', 'STILL.md']);
  const reconciled = reconcileUnseen(unseen, ['STILL.md', 'DEMO-BRAINSTORM.html']);
  assert.equal(reconciled.has('GONE.html'), false, 'deleted file removed from unseen on reconcile');
  assert.equal(reconciled.has('STILL.md'), true, 'present file retained');
});

test('snapshot returns mtimes for change detection (FR-8)', async () => {
  const fakeFetch = async () =>
    ({ ok: true, json: async () => ({ files: ['A.md'], mtimes: { 'A.md': 123 } }) } as Response);
  const snap = await fetchArtifactSnapshot('DEMO', fakeFetch as typeof fetch);
  assert.deepEqual(snap.mtimes, { 'A.md': 123 });
});

test('diffSnapshots derives added, changed (by mtime), and removed files (FR-8, FR-9)', () => {
  const changes = diffSnapshots(
    ['keep.md', 'gone.md', 'edit.md'],
    { 'keep.md': 1, 'gone.md': 1, 'edit.md': 1 },
    ['keep.md', 'edit.md', 'new.md'],
    { 'keep.md': 1, 'edit.md': 5, 'new.md': 2 },
  );
  const byName = Object.fromEntries(changes.map((c) => [c.fileName, c.kind]));
  assert.deepEqual(byName, { 'new.md': 'added', 'edit.md': 'changed', 'gone.md': 'removed' });
  assert.equal(changes.length, 3, 'an unchanged file emits no change');
});
