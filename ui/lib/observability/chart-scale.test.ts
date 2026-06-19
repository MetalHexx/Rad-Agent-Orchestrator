import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceMax } from './chart-scale';

test('niceMax rounds up to a stable, nice maximum >= the data peak (DD-5)', () => {
  assert.equal(niceMax([0]), 1, 'empty/zero data still yields a positive domain');
  assert.equal(niceMax([12]), 20);
  assert.equal(niceMax([1, 99]), 100);
  assert.ok(niceMax([2_400_000]) >= 2_400_000, 'covers the peak');
  assert.equal(niceMax([120]), niceMax([180]), 'stable across nearby peaks (no refresh jitter)');
});
