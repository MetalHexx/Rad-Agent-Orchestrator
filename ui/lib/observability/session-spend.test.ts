import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionSpendInRange } from './session-spend';
import { effectiveTokens } from './effective-tokens';
import { sumRawTokens } from './raw-tokens';
import { rowsSince, rowsInWindow } from './sessions';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = (o: Partial<any> = {}): any => ({
  sessionId: 's1', usageId: 'u1', timestamp: '2026-06-18T00:00:00.000Z',
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, ...o,
});

test('rangeEnd-clamped: a row beyond endMs is excluded — the session-detail canonical behavior', () => {
  const rangeStart = Date.parse('2026-06-18T00:00:00.000Z');
  const rangeEnd = Date.parse('2026-06-18T01:00:00.000Z');
  const rows = [
    row({ usageId: 'a', timestamp: '2026-06-18T00:30:00.000Z', outputTokens: 2 }), // in window: effective 10
    row({ usageId: 'b', timestamp: '2026-06-18T01:00:30.000Z', outputTokens: 4 }), // live-tail row, past rangeEnd
  ];
  assert.equal(sessionSpendInRange(rows, 's1', rangeStart, rangeEnd), 10, 'the live-tail row past rangeEnd is excluded');
});

test('open-ended rowsSince and rangeEnd-clamped rowsInWindow diverge on the same rows/range; sessionSpendInRange matches the clamped (session-detail) figure', () => {
  const rangeStart = Date.parse('2026-06-18T00:00:00.000Z');
  const rangeEnd = Date.parse('2026-06-18T01:00:00.000Z');
  const rows = [
    row({ usageId: 'a', timestamp: '2026-06-18T00:30:00.000Z', outputTokens: 2 }), // 10
    row({ usageId: 'b', timestamp: '2026-06-18T01:00:30.000Z', outputTokens: 4 }), // 20, past rangeEnd
  ];

  // The overview's OLD open-ended windowing (rowsSince, no upper bound) sums both rows...
  const openEndedTotal = rowsSince(rows, rangeStart).reduce((sum, r) => sum + effectiveTokens(r), 0);
  assert.equal(openEndedTotal, 30, 'sanity: open-ended windowing would have included the live-tail row');

  // ...while the reconciled helper agrees with session-detail's rowsInWindow clamp.
  const reconciled = sessionSpendInRange(rows, 's1', rangeStart, rangeEnd);
  assert.equal(reconciled, 10);
  assert.notEqual(reconciled, openEndedTotal, 'the two windowing strategies genuinely diverge on this fixture');
});

test('filters to the requested sessionId — other sessions in the same window do not bleed in', () => {
  const rangeStart = Date.parse('2026-06-18T00:00:00.000Z');
  const rangeEnd = Date.parse('2026-06-18T01:00:00.000Z');
  const rows = [
    row({ sessionId: 's1', usageId: 'a', timestamp: '2026-06-18T00:10:00.000Z', outputTokens: 2 }), // 10
    row({ sessionId: 's2', usageId: 'b', timestamp: '2026-06-18T00:20:00.000Z', outputTokens: 100 }), // 500, different session
  ];
  assert.equal(sessionSpendInRange(rows, 's1', rangeStart, rangeEnd), 10);
  assert.equal(sessionSpendInRange(rows, 's2', rangeStart, rangeEnd), 500);
});

test('excludes rows before rangeStart', () => {
  const rangeStart = Date.parse('2026-06-18T00:00:00.000Z');
  const rangeEnd = Date.parse('2026-06-18T01:00:00.000Z');
  const rows = [
    row({ usageId: 'early', timestamp: '2026-06-17T23:00:00.000Z', outputTokens: 9 }), // before rangeStart
    row({ usageId: 'in', timestamp: '2026-06-18T00:05:00.000Z', outputTokens: 1 }), // 5
  ];
  assert.equal(sessionSpendInRange(rows, 's1', rangeStart, rangeEnd), 5);
});

test('boundary rows exactly at rangeStart/rangeEnd are inclusive, matching rowsInWindow (FR-3)', () => {
  const rangeStart = Date.parse('2026-06-18T00:00:00.000Z');
  const rangeEnd = Date.parse('2026-06-18T01:00:00.000Z');
  const rows = [
    row({ usageId: 'start', timestamp: '2026-06-18T00:00:00.000Z', outputTokens: 1 }), // exactly rangeStart: 5
    row({ usageId: 'end', timestamp: '2026-06-18T01:00:00.000Z', outputTokens: 1 }),   // exactly rangeEnd: 5
  ];
  assert.equal(sessionSpendInRange(rows, 's1', rangeStart, rangeEnd), 10, 'both boundary rows are inclusive');
});

test('empty row set and non-matching sessionId both yield zero', () => {
  assert.equal(sessionSpendInRange([], 's1', 0, 1_000), 0);
  const rows = [row({ sessionId: 'other', timestamp: '2026-06-18T00:10:00.000Z', outputTokens: 1 })];
  assert.equal(sessionSpendInRange(rows, 's1', 0, Date.parse('2026-06-19T00:00:00.000Z')), 0);
});

test('the raw-token breakdown over the same windowed+filtered rows sums to the headline figure inputs, matching the receipt to the number above it', () => {
  const rangeStart = Date.parse('2026-06-18T00:00:00.000Z');
  const rangeEnd = Date.parse('2026-06-18T01:00:00.000Z');
  const rows = [
    row({ usageId: 'a', timestamp: '2026-06-18T00:10:00.000Z', inputTokens: 100, outputTokens: 20, cacheReadTokens: 5000, cacheCreationTokens: 40 }),
    row({ usageId: 'b', timestamp: '2026-06-18T00:40:00.000Z', inputTokens: 50, outputTokens: 10, cacheReadTokens: 1000, cacheCreationTokens: 60 }),
    row({ usageId: 'live-tail', timestamp: '2026-06-18T01:05:00.000Z', inputTokens: 999, outputTokens: 999 }), // past rangeEnd — must drop from BOTH
    row({ sessionId: 'other-session', usageId: 'c', timestamp: '2026-06-18T00:15:00.000Z', inputTokens: 500, outputTokens: 500 }), // different session — must drop from BOTH
  ];

  const headline = sessionSpendInRange(rows, 's1', rangeStart, rangeEnd);

  // The breakdown must consume the identical windowed+filtered row set that fed the headline.
  const windowedSessionRows = rowsInWindow(rows, rangeStart, rangeEnd).filter((r) => r.sessionId === 's1');
  const breakdown = sumRawTokens(windowedSessionRows);

  assert.deepEqual(breakdown, { input: 150, output: 30, cacheRead: 6000, cacheCreate: 100 });
  const recomputedHeadline = windowedSessionRows.reduce((sum, r) => sum + effectiveTokens(r), 0);
  assert.equal(headline, recomputedHeadline, 'headline and breakdown are derived from the same windowed rows');
  assert.equal(headline, 150 * 1 + 30 * 5 + 6000 * 0.1 + 100 * 1.25);
});
