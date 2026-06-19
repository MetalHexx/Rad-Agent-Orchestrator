/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTokens } from './effective-tokens';
import { upsertRows, deriveSessions, sessionDuration, timeBucketedRate, rowKey, rowsInWindow, rowsSince } from './sessions';

const row = (o: Partial<any> = {}): any => ({
  sessionId: 's1', usageId: 'u1', timestamp: '2026-06-18T00:00:00.000Z',
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, ...o,
});

test('effectiveTokens applies the billing weights and treats absent cache as 0 (AD-3)', () => {
  assert.equal(effectiveTokens({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 100, cacheCreationTokens: 4 }), 10 + 10 + 10 + 5);
  assert.equal(effectiveTokens({ inputTokens: 1, outputTokens: 0 } as any), 1);
});

test('upsertRows dedups by the (sessionId, usageId) composite, last-wins (AD-4, NFR-3)', () => {
  const map = upsertRows(new Map(), [row({ outputTokens: 1 }), row({ outputTokens: 9 })]);
  assert.equal(map.size, 1, 'same composite collapses to one row');
  assert.equal([...map.values()][0].outputTokens, 9, 'keeps the last-appended row');
  // same usageId, different session must NOT collide
  const map2 = upsertRows(map, [row({ sessionId: 's2', outputTokens: 3 })]);
  assert.equal(map2.size, 2);
  assert.equal(rowKey(row({ sessionId: 's2' })), 's2 u1');
});

test('deriveSessions sums spend over ALL rows incl. subagents sharing the sessionId (FR-8)', () => {
  // subagent rows share the parent sessionId; they must roll into the session total
  const rows = [
    row({ usageId: 'a', inputTokens: 0, outputTokens: 2 }),               // main: 10
    row({ usageId: 'b', inputTokens: 0, outputTokens: 0, cacheReadTokens: 1000 }), // subagent: 100
  ];
  const sessions = deriveSessions(upsertRows(new Map(), rows));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].spend, 110);
});

test('sessionDuration is last - first timestamp across all rows (FR-9)', () => {
  const rows = [
    row({ usageId: 'a', timestamp: '2026-06-18T00:00:00.000Z' }),
    row({ usageId: 'b', timestamp: '2026-06-18T02:30:00.000Z' }),
  ];
  const s = deriveSessions(upsertRows(new Map(), rows))[0];
  assert.equal(sessionDuration(s), 2.5 * 60 * 60 * 1000);
});

test('timeBucketedRate is spiky (per-bucket sums), not cumulative (FR-10)', () => {
  const rows = [
    row({ usageId: 'a', timestamp: '2026-06-18T00:00:00.000Z', outputTokens: 2 }), // 10
    row({ usageId: 'b', timestamp: '2026-06-18T00:09:00.000Z', outputTokens: 4 }), // 20
  ];
  const series = timeBucketedRate([...upsertRows(new Map(), rows).values()], {
    endMs: Date.parse('2026-06-18T00:10:00.000Z'), windowMs: 10 * 60 * 1000, buckets: 2,
  });
  assert.equal(series.length, 2);
  assert.equal(series[0].value, 10);
  assert.equal(series[1].value, 20); // not 30 — buckets do not accumulate
});

test('rowsInWindow keeps only rows within [startMs, endMs] (FR-3)', () => {
  const rows = [
    row({ usageId: 'a', timestamp: '2026-06-18T00:00:00.000Z' }),
    row({ usageId: 'b', timestamp: '2026-06-18T05:00:00.000Z' }),
    row({ usageId: 'c', timestamp: '2026-06-18T23:00:00.000Z' }),
  ];
  const out = rowsInWindow(rows, Date.parse('2026-06-18T01:00:00.000Z'), Date.parse('2026-06-18T12:00:00.000Z'));
  assert.deepEqual(out.map(r => r.usageId), ['b']);
});

test('timeBucketedRate yields a flat zero series for a zero-length window (FR-5)', () => {
  const t = Date.parse('2026-06-18T00:00:00.000Z');
  const series = timeBucketedRate([row({ timestamp: '2026-06-18T00:00:00.000Z', outputTokens: 2 })], { endMs: t, windowMs: 0, buckets: 30 });
  assert.equal(series.length, 30);
  assert.ok(series.every(p => Number.isFinite(p.t) && Number.isFinite(p.value)), 'no NaN buckets');
});

test('rowsSince keeps the live tail so SSE appends newer than rangeEnd are not dropped (FR-9, AD-6)', () => {
  const rangeStart = Date.parse('2026-06-18T00:00:00.000Z');
  const rangeEnd   = Date.parse('2026-06-18T01:00:00.000Z'); // tick-pinned, already stale
  const rows = [...upsertRows(new Map(), [
    row({ sessionId: 's-old', usageId: 'a', timestamp: '2026-06-18T00:30:00.000Z', outputTokens: 2 }),
    row({ sessionId: 's-new', usageId: 'b', timestamp: '2026-06-18T01:00:30.000Z', outputTokens: 4 }), // SSE append after rangeEnd
    row({ sessionId: 's-early', usageId: 'c', timestamp: '2026-06-17T23:59:00.000Z', outputTokens: 8 }), // before rangeStart
  ]).values()];
  // The old clamped window drops the live-tail row…
  assert.ok(!rowsInWindow(rows, rangeStart, rangeEnd).some(r => r.sessionId === 's-new'), 'clamped window drops the live-tail row');
  // …rowsSince keeps it, still drops the pre-window row.
  const live = rowsSince(rows, rangeStart);
  assert.ok(live.some(r => r.sessionId === 's-new'), 'live-tail row kept');
  assert.ok(!live.some(r => r.sessionId === 's-early'), 'rows before rangeStart still excluded');
});

test('a new SSE row surfaces a new session and updates an existing one (FR-9)', () => {
  let map = upsertRows(new Map(), [row({ sessionId: 's1', usageId: 'a', timestamp: '2026-06-18T00:00:00.000Z', outputTokens: 2 })]);
  let s1 = deriveSessions(rowsSince([...map.values()], 0)).find(s => s.sessionId === 's1');
  assert.equal(s1.spend, 10); // outputTokens 2 → effective 10
  assert.equal(s1.lastMs, Date.parse('2026-06-18T00:00:00.000Z'));
  // SSE delivers a later row for s1 and a first row for a brand-new s2
  map = upsertRows(map, [
    row({ sessionId: 's1', usageId: 'b', timestamp: '2026-06-18T00:05:00.000Z', outputTokens: 4 }),
    row({ sessionId: 's2', usageId: 'c', timestamp: '2026-06-18T00:06:00.000Z', outputTokens: 2 }),
  ]);
  const sessions = deriveSessions(rowsSince([...map.values()], 0));
  s1 = sessions.find(s => s.sessionId === 's1');
  assert.equal(s1.spend, 30, 'existing row spend folds in the new telemetry');
  assert.equal(s1.lastMs, Date.parse('2026-06-18T00:05:00.000Z'), 'lastMs advances (Activity dot + Duration update)');
  assert.ok(sessions.some(s => s.sessionId === 's2'), 'new session appears');
});

test('timeBucketedRate grid mode anchors buckets to an absolute clock — shape is stable as the window slides', () => {
  const WINDOW = 10 * 60 * 1000; // 10 min over 2 buckets → 5 min grid
  const rows = [row({ usageId: 'a', timestamp: '2026-06-18T00:07:00.000Z', outputTokens: 2 })]; // effective 10
  const gridAt = (iso: string) =>
    timeBucketedRate(rows, { endMs: Date.parse(iso), windowMs: WINDOW, buckets: 2, anchor: 'grid' });

  // Advancing the window end by 1 min (< the 5-min bucket size) must NOT re-bucket the row: it stays
  // pinned to the absolute 00:05 grid point in both renders (this is what kills the per-tick warp).
  const gridT = Date.parse('2026-06-18T00:05:00.000Z');
  const b1 = gridAt('2026-06-18T00:10:00.000Z').find(p => p.value > 0);
  const b2 = gridAt('2026-06-18T00:11:00.000Z').find(p => p.value > 0);
  assert.ok(b1 && b2, 'the spend bucket exists in both renders');
  assert.equal(b1.t, gridT, 'bucket is anchored to the absolute 5-min grid');
  assert.equal(b2.t, gridT, 'same absolute bucket after the window advances — no warp');
  assert.equal(b1.value, 10);
  assert.equal(b2.value, 10);

  // Contrast: the default 'window' mode re-anchors to endMs, so the same row lands on a different t
  // when the window moves — that is the distortion grid mode fixes.
  const w1 = timeBucketedRate(rows, { endMs: Date.parse('2026-06-18T00:10:00.000Z'), windowMs: WINDOW, buckets: 2 }).find(p => p.value > 0);
  const w2 = timeBucketedRate(rows, { endMs: Date.parse('2026-06-18T00:11:00.000Z'), windowMs: WINDOW, buckets: 2 }).find(p => p.value > 0);
  assert.notEqual(w1.t, w2.t, 'window mode re-anchors (the old warp); grid mode does not');
});
