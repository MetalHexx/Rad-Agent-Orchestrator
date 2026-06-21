import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeWindow } from './time-window';
import { retentionFloorMs, presetMs } from '@/lib/time-range/range';
import { bucketsForWindow } from '@/lib/observability/time-range';

const NOW = Date.parse('2026-06-21T12:00:00Z');
const FLOOR = retentionFloorMs(NOW);

test('exposes raw bounds from resolveWindow for a relative range (AD-2, FR-11)', () => {
  const w = new TimeWindow({ kind: 'relative', preset: '6h' }, NOW, FLOOR);
  assert.equal(w.rangeEnd, NOW);
  assert.equal(w.rangeStart, Math.max(NOW - presetMs('6h'), FLOOR));
});

test('nominal window + bucket count derive from the snapped preset, not the raw span (AD-2, FR-11)', () => {
  const w = new TimeWindow({ kind: 'relative', preset: '6h' }, NOW, FLOOR);
  assert.equal(w.nominalWindowMs, presetMs('6h'));
  assert.equal(w.buckets, bucketsForWindow(presetMs('6h')));
});

test('chartBucketOpts buckets to the raw range end with a grid anchor (AD-2, FR-11)', () => {
  const w = new TimeWindow({ kind: 'relative', preset: '1h' }, NOW, FLOOR);
  const opts = w.chartBucketOpts();
  assert.equal(opts.endMs, w.rangeEnd);
  assert.equal(opts.windowMs, w.nominalWindowMs);
  assert.equal(opts.buckets, w.buckets);
  assert.equal(opts.anchor, 'grid');
});
