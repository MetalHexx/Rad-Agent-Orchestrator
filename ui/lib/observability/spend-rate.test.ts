import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpendRateChart, visibleSeriesKeys, DEFAULT_HIDDEN_KEYS, type SpendRateSeries } from './spend-rate';
import { TimeWindow } from './time-window';
import { retentionFloorMs } from '@/lib/time-range/range';

const NOW = Date.parse('2026-06-21T12:00:00Z');
const win = new TimeWindow({ kind: 'relative', preset: '1h' }, NOW, retentionFloorMs(NOW));
const row = (model: string, t: string) => ({
  sessionId: 's1', usageId: model + t, model, timestamp: t,
  inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

test('series is one sorted line per model present — no aggregate "All models" entry (AD-3, FR-3, DD-4)', () => {
  const rows = [row('opus', '2026-06-21T11:30:00Z'), row('haiku', '2026-06-21T11:31:00Z')];
  const { series } = buildSpendRateChart(rows, win);
  assert.deepEqual(series.map((s) => s.key), ['haiku', 'opus']);
  assert.ok(!series.some((s) => s.key === 'total'), 'no total/"All models" series — it is not a real filterable model');
});

test('empty rows → no series at all (AD-3, FR-3)', () => {
  const { series, data } = buildSpendRateChart([], win);
  assert.equal(series.length, 0);
  assert.ok(Array.isArray(data));
});

// --- Chart line visibility (FR-4): every model on by default, opt-OUT per line, no load flash ---

const VIZ_SERIES: SpendRateSeries[] = [
  { key: 'opus',   label: 'opus',       cssVar: '--c-a' },
  { key: 'sonnet', label: 'sonnet',     cssVar: '--c-b' },
];

test('default shows every model line — nothing hidden (FR-4)', () => {
  assert.deepEqual(visibleSeriesKeys(VIZ_SERIES, DEFAULT_HIDDEN_KEYS), ['opus', 'sonnet']);
});

test('a newly-arriving model is shown immediately, same as every other model (FR-4, FR-7)', () => {
  // Simulate the post-mount data load / SSE live-tail: `series` grows from [opus, sonnet] to
  // [opus, sonnet, haiku] while the hidden set is unchanged (still empty). The new model must
  // appear visible on its very first frame — it should be "activated" the moment it shows up,
  // not hidden until the user opts it in.
  const hidden = new Set(DEFAULT_HIDDEN_KEYS);
  const grown: SpendRateSeries[] = [...VIZ_SERIES, { key: 'haiku', label: 'haiku', cssVar: '--c-c' }];
  assert.deepEqual(visibleSeriesKeys(grown, hidden), ['opus', 'sonnet', 'haiku'], 'the new model line is visible immediately');
});

test('hiding a model via the legend removes exactly that line (FR-4)', () => {
  const hidden = new Set(['opus']);
  assert.deepEqual(visibleSeriesKeys(VIZ_SERIES, hidden), ['sonnet']);
});

test('a model the user hid stays hidden when more series arrive later (FR-7)', () => {
  // The hidden set only changes on a legend click, so a later series update neither un-hides the
  // user's hidden model nor hides the newly-arrived one.
  const hidden = new Set(['opus']);
  const grown: SpendRateSeries[] = [...VIZ_SERIES, { key: 'haiku', label: 'haiku', cssVar: '--c-c' }];
  assert.deepEqual(visibleSeriesKeys(grown, hidden), ['sonnet', 'haiku'], 'hidden model stays hidden, new model shown');
});

test('the user can hide every line at once', () => {
  assert.deepEqual(visibleSeriesKeys(VIZ_SERIES, new Set(['opus', 'sonnet'])), []);
});
