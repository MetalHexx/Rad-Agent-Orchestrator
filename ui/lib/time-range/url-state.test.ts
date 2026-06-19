// ui/lib/time-range/url-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readViewState, writeViewState } from './url-state';

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
