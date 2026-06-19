import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_RANGES, DEFAULT_RANGE_ID, rangeWindow, rangeUtcDates, bucketsForWindow } from './time-range';

test('offers the six quick ranges and defaults to 24h (FR-1)', () => {
  assert.deepEqual(QUICK_RANGES.map(r => r.id), ['15m', '1h', '6h', '24h', '7d', '14d']);
  assert.equal(DEFAULT_RANGE_ID, '24h');
});

test('rangeWindow returns [now-span, now] for a relative range (FR-1, AD-1)', () => {
  const now = Date.parse('2026-06-18T12:00:00.000Z');
  const w = rangeWindow('24h', now);
  assert.equal(w.endMs, now);
  assert.equal(w.startMs, now - 24 * 60 * 60 * 1000);
});

test('rangeUtcDates lists every UTC partition date the window spans (FR-4)', () => {
  const start = Date.parse('2026-06-17T20:00:00.000Z');
  const end = Date.parse('2026-06-18T04:00:00.000Z');
  assert.deepEqual(rangeUtcDates(start, end), ['2026-06-17', '2026-06-18']);
});

test('bucketsForWindow scales the chart resolution to the range within 60..120 (NFR-4)', () => {
  assert.equal(bucketsForWindow(15 * 60 * 1000), 60);          // short range floors at 60
  assert.equal(bucketsForWindow(6 * 60 * 60 * 1000), 72);      // mid range scales up
  assert.equal(bucketsForWindow(24 * 60 * 60 * 1000), 120);    // long range caps at 120
});
