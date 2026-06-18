import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTokens } from './effective-tokens';
import { upsertRows, deriveSessions, sessionDuration, timeBucketedRate, rowKey } from './sessions';

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
