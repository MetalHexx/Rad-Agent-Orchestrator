import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpendRateChart, visibleSeriesKeys, DEFAULT_SHOWN_KEYS, type SpendRateSeries } from './spend-rate';
import { TimeWindow } from './time-window';
import { retentionFloorMs } from '@/lib/time-range/range';

const NOW = Date.parse('2026-06-21T12:00:00Z');
const win = new TimeWindow({ kind: 'relative', preset: '1h' }, NOW, retentionFloorMs(NOW));
const row = (model: string, t: string) => ({
  sessionId: 's1', usageId: model + t, model, timestamp: t,
  inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// --- Chart line visibility (FR-4): default total-only, per-model opt-in, no load flash ---

const VIZ_SERIES: SpendRateSeries[] = [
  { key: 'total',  label: 'All models', cssVar: '--chart-2' },
  { key: 'opus',   label: 'opus',       cssVar: '--c-a' },
  { key: 'sonnet', label: 'sonnet',     cssVar: '--c-b' },
];

test('default shows only the total / "All models" line (FR-4)', () => {
  assert.deepEqual(visibleSeriesKeys(VIZ_SERIES, DEFAULT_SHOWN_KEYS), ['total']);
});

test('late-arriving model lines stay hidden — the flash invariant (FR-4, FR-7)', () => {
  // Simulate the post-mount data load / SSE live-tail: `series` grows from [total] to
  // [total, …models] while the opt-in set is unchanged. Visibility must NOT depend on that
  // growth or render order — this is exactly what kills the one-frame flash on load.
  const shown = new Set(DEFAULT_SHOWN_KEYS);
  const grown: SpendRateSeries[] = [...VIZ_SERIES, { key: 'haiku', label: 'haiku', cssVar: '--c-c' }];
  assert.deepEqual(visibleSeriesKeys(grown, shown), ['total'], 'models that appear after mount remain hidden');
});

test('opting a model in via the legend reveals exactly that line (FR-4)', () => {
  const shown = new Set([...DEFAULT_SHOWN_KEYS, 'opus']);
  assert.deepEqual(visibleSeriesKeys(VIZ_SERIES, shown), ['total', 'opus']);
});

test('a model the user opted in stays visible when more series arrive later (FR-7)', () => {
  // The opt-in set only changes on a legend click, so a later series update neither drops the
  // user's opted-in model nor auto-shows the newly-arrived one.
  const shown = new Set([...DEFAULT_SHOWN_KEYS, 'opus']);
  const grown: SpendRateSeries[] = [...VIZ_SERIES, { key: 'haiku', label: 'haiku', cssVar: '--c-c' }];
  assert.deepEqual(visibleSeriesKeys(grown, shown), ['total', 'opus'], 'opted-in model kept, new model not auto-shown');
});

test('the user can also hide the total line (toggled fully off)', () => {
  assert.deepEqual(visibleSeriesKeys(VIZ_SERIES, new Set<string>()), []);
});
