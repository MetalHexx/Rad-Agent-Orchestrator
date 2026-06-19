// ui/lib/time-range/range.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindow, isLive, presetMs, snapUpToPresetMs, DEFAULT_RANGE, type TimeRange } from './range';

const NOW = Date.parse('2026-06-19T12:00:00Z');
const FLOOR = Date.parse('2026-06-06T00:00:00Z');

test('relative resolves to [now - preset, now] and is live (FR-2, FR-3, AD-1)', () => {
  const r: TimeRange = { kind: 'relative', preset: '1h' };
  assert.deepEqual(resolveWindow(r, NOW, FLOOR), { startMs: NOW - presetMs('1h'), endMs: NOW });
  assert.equal(isLive(r), true);
});

test('since clamps start up to the retention floor and tracks now (FR-13, AD-2)', () => {
  const r: TimeRange = { kind: 'since', startMs: FLOOR - 86_400_000 };
  assert.deepEqual(resolveWindow(r, NOW, FLOOR), { startMs: FLOOR, endMs: NOW });
  assert.equal(isLive(r), true);
});

test('absolute is bounded and static (AD-1, AD-2)', () => {
  const r: TimeRange = { kind: 'absolute', startMs: NOW - 7_200_000, endMs: NOW - 3_600_000 };
  assert.deepEqual(resolveWindow(r, NOW, FLOOR), { startMs: NOW - 7_200_000, endMs: NOW - 3_600_000 });
  assert.equal(isLive(r), false);
});

test('DEFAULT_RANGE is relative 24h; since-window snaps up to a preset tier (FR-3)', () => {
  assert.deepEqual(DEFAULT_RANGE, { kind: 'relative', preset: '24h' });
  assert.equal(snapUpToPresetMs(90 * 60_000), 6 * 60 * 60_000); // 90m → snaps up to 6h tier
});
