import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpendRateChart } from './spend-rate';
import { TimeWindow } from './time-window';
import { retentionFloorMs } from '@/lib/time-range/range';

const NOW = Date.parse('2026-06-21T12:00:00Z');
const win = new TimeWindow({ kind: 'relative', preset: '1h' }, NOW, retentionFloorMs(NOW));
const row = (model: string, t: string) => ({
  sessionId: 's1', usageId: model + t, model, timestamp: t,
  inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
} as any);

test('series is total + one sorted line per model present (AD-3, FR-3, DD-4)', () => {
  const rows = [row('opus', '2026-06-21T11:30:00Z'), row('haiku', '2026-06-21T11:31:00Z')];
  const { series } = buildSpendRateChart(rows, win);
  assert.equal(series[0].key, 'total');
  assert.equal(series[0].cssVar, '--chart-2');
  assert.deepEqual(series.slice(1).map((s) => s.key), ['haiku', 'opus']);
});

test('empty rows → only the total series, no model lines (AD-3, FR-3)', () => {
  const { series, data } = buildSpendRateChart([], win);
  assert.equal(series.length, 1);
  assert.equal(series[0].key, 'total');
  assert.ok(Array.isArray(data));
});
