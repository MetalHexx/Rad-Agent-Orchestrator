import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowMsForBuckets } from './bucket-count';
import { presetMs } from '@/lib/time-range/range';

const NOW = Date.parse('2026-06-19T12:00:00Z');

test('relative uses the preset length (AD-11)', () => {
  assert.equal(windowMsForBuckets({ kind: 'relative', preset: '6h' }, NOW), presetMs('6h'));
});

test('since snaps the elapsed span UP to a preset tier so the grid is stable (AD-11, NFR-6)', () => {
  const start = NOW - 90 * 60_000; // 90 minutes ago → snaps up to 3h tier
  assert.equal(windowMsForBuckets({ kind: 'since', startMs: start }, NOW), presetMs('3h'));
});

test('absolute uses its exact bounded length (AD-11)', () => {
  const r = { kind: 'absolute' as const, startMs: NOW - 7_200_000, endMs: NOW - 3_600_000 };
  assert.equal(windowMsForBuckets(r, NOW), 3_600_000);
});
