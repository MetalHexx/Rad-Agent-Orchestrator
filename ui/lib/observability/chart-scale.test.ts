import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceMax, niceAxis } from './chart-scale';

test('niceMax rounds up to a stable, nice maximum >= the data peak (DD-5)', () => {
  assert.equal(niceMax([0]), 1, 'empty/zero data still yields a positive domain');
  assert.equal(niceMax([12]), 20);
  assert.equal(niceMax([1, 99]), 100);
  assert.ok(niceMax([2_400_000]) >= 2_400_000, 'covers the peak');
  assert.equal(niceMax([120]), niceMax([180]), 'stable across nearby peaks (no refresh jitter)');
});

test('niceAxis fits tightly, stays integer-clean, and never collapses to duplicate labels', () => {
  // Grafana/D3-style nice-step axis: hug the data peak (no coarse round-up dead space) while keeping
  // ticks on nice, distinct, integer values — so an empty/idle window reads 0,1,2,3,4, never "0 0 1 1 1".
  const tight = niceAxis(150_000, 5);
  assert.equal(tight.max, 150_000, 'hugs the peak (no 200k dead space)');
  assert.ok(tight.max < niceMax([150_000]), 'tighter than the coarse niceMax round-up');
  assert.ok(tight.max >= 150_000, 'still covers the peak');
  assert.deepEqual(niceAxis(0, 5), { max: 4, ticks: [0, 1, 2, 3, 4] }, 'empty window → clean integer axis');
  const tiny = niceAxis(2, 5);
  assert.ok(tiny.ticks.every(Number.isInteger), 'tiny ranges use integer ticks');
  assert.equal(new Set(tiny.ticks).size, tiny.ticks.length, 'no duplicate ticks (kills "0 0 1 1 1")');
  assert.ok(niceAxis(180_000, 5).max >= 180_000, 'covers a peak that is not itself a nice step');
  // Regression: the 2.5 nice-step rung at pow=1 (dataMax 9–10) must NOT produce a fractional step —
  // [0,2.5,5,7.5,10] humanizes to mislabeled gridlines (0,3,5,8,10) on an allowDecimals={false} axis.
  for (const peak of [7, 9, 10, 25, 100]) {
    const a = niceAxis(peak, 5);
    assert.ok(a.ticks.every(Number.isInteger), `niceAxis(${peak}) ticks are integers`);
    assert.ok(a.max >= peak, `niceAxis(${peak}) covers the peak`);
  }
  // Non-finite / non-positive peaks fall back to the clean 0..4 axis (no NaN domain, no crash).
  assert.deepEqual(niceAxis(Infinity, 5), { max: 4, ticks: [0, 1, 2, 3, 4] }, 'Infinity → clean fallback');
  assert.deepEqual(niceAxis(NaN, 5), { max: 4, ticks: [0, 1, 2, 3, 4] }, 'NaN → clean fallback');
});
