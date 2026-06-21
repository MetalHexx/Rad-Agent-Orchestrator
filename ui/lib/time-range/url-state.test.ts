// ui/lib/time-range/url-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readViewState, writeViewState, readRangeState, writeRangeState } from './url-state';

test('round-trips range + filters through a query string (FR-12, AD-8)', () => {
  const state = {
    range: { kind: 'absolute' as const, startMs: 1_718_745_430_000, endMs: 1_718_759_964_000 },
    worktree: 'C:\\dev\\my repo', session: '7b5e4c80',
  };
  const qs = writeViewState(new URLSearchParams(), state);
  const back = readViewState(new URLSearchParams(qs));
  assert.deepEqual(back, state);
});

test('the worktree (a Windows path) is percent-encoded in the query (AD-8)', () => {
  const qs = writeViewState(new URLSearchParams(), {
    range: { kind: 'relative' as const, preset: '24h' }, worktree: 'C:\\a b', session: 'All',
  });
  assert.match(qs, /worktree=C%3A%5Ca%20b/);
  assert.doesNotMatch(qs, /session=/); // "All" is the default → omitted
});

test('range-only codec round-trips a relative range (AD-5, FR-8)', () => {
  const qs = writeRangeState(new URLSearchParams(), { range: { kind: 'relative', preset: '6h' } });
  const params = new URLSearchParams(qs);
  assert.equal(params.get('range'), 'rel:6h');
  assert.equal(readRangeState(params).range.kind, 'relative');
});

test('range-only write never emits filter keys of its own (AD-5, NFR-2)', () => {
  const qs = writeRangeState(new URLSearchParams(), { range: { kind: 'relative', preset: '1h' } });
  const params = new URLSearchParams(qs);
  assert.equal(params.get('worktree'), null);
  assert.equal(params.get('session'), null);
});

test('the range+filters codec still reads filters (AD-5, FR-11)', () => {
  const vs = readViewState(new URLSearchParams('range=rel:1h&worktree=wt&session=s1'));
  assert.equal(vs.worktree, 'wt');
  assert.equal(vs.session, 's1');
});
