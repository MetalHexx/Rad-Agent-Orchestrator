// ui/lib/observability/fit-to-session.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitToSession } from './fit-to-session';
import { snapUpToPresetMs } from '../time-range/range';
import { bucketsForWindow } from './time-range';

const FLOOR = Date.parse('2026-06-06T00:00:00Z');

// Helper: compute expected lead-in given the same formulas as the impl
function expectedLeadIn(startedMs: number, nowMs: number): { nominalWindowMs: number; bucketMs: number; leadInMs: number } {
  const nominalWindowMs = snapUpToPresetMs(nowMs - startedMs);
  const bucketMs = nominalWindowMs / bucketsForWindow(nominalWindowMs);
  const leadInMs = 2 * bucketMs;
  return { nominalWindowMs, bucketMs, leadInMs };
}

test('(a) start is a lead-in before startedMs for a mid-retention session well above the floor (FR-5)', () => {
  const startedMs = Date.parse('2026-06-18T08:00:00Z');
  const nowMs = Date.parse('2026-06-18T10:00:00Z'); // 2h session, well above floor
  const result = fitToSession(startedMs, FLOOR, nowMs);
  const { bucketMs } = expectedLeadIn(startedMs, nowMs);
  assert.equal(result.kind, 'since');
  assert.ok(result.startMs < startedMs, 'startMs is backed off before startedMs');
  assert.equal(result.startMs, startedMs - 2 * bucketMs, 'startMs equals startedMs minus 2 bucketMs');
});

test('(b) lead-in is at least one bucket width (startedMs - result.startMs >= bucketMs) (FR-5)', () => {
  const startedMs = Date.parse('2026-06-18T08:00:00Z');
  const nowMs = Date.parse('2026-06-18T10:00:00Z');
  const result = fitToSession(startedMs, FLOOR, nowMs);
  const { bucketMs } = expectedLeadIn(startedMs, nowMs);
  assert.equal(result.kind, 'since');
  assert.ok(startedMs - result.startMs >= bucketMs, 'lead-in spans at least one bucket width');
});

test('(c) floor clamp: when startedMs - leadIn < floor, result clamps to floor (FR-6)', () => {
  // startedMs === FLOOR means startedMs - leadIn < FLOOR, so must clamp
  const startedMs = FLOOR;
  const nowMs = FLOOR + 2 * 60 * 60 * 1000; // 2h later
  const result = fitToSession(startedMs, FLOOR, nowMs);
  assert.equal(result.kind, 'since');
  assert.equal(result.startMs, FLOOR, 'clamped to retention floor');
});

test('(d) now <= start: stays finite and clamped, no NaN (edge case)', () => {
  const startedMs = Date.parse('2026-06-18T08:00:00Z');
  const nowMs = startedMs; // nowMs === startedMs → delta is 0
  const result = fitToSession(startedMs, FLOOR, nowMs);
  assert.equal(result.kind, 'since');
  assert.ok(Number.isFinite(result.startMs), 'startMs is finite');
  assert.ok(!Number.isNaN(result.startMs), 'startMs is not NaN');
  assert.ok(result.startMs >= FLOOR, 'startMs is at or above retention floor');
});

test('(e) near a preset-tier boundary, lead-in still spans >= 2 buckets of the ACTUAL post-shift chart grid (no clip)', () => {
  const startedMs = Date.parse('2026-06-18T08:00:00Z');
  const nowMs = startedMs + 59 * 60 * 1000; // 59-min session: the lead-in pushes the since-window across the 1h->3h tier
  const result = fitToSession(startedMs, FLOOR, nowMs);
  assert.equal(result.kind, 'since');
  // The chart grids from the FINAL since-start, so derive the real bucket size from result.startMs.
  const chartNominalMs = snapUpToPresetMs(nowMs - result.startMs);
  const chartBucketMs = chartNominalMs / bucketsForWindow(chartNominalMs);
  assert.ok(startedMs - result.startMs >= 2 * chartBucketMs,
    'lead-in spans >= 2 buckets of the grid the chart will actually render');
});
