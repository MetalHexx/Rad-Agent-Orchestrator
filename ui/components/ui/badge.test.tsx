import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeVariants } from './badge';

test('the accent variant is house-purple, backed by the --live token (DD-3)', () => {
  const cls = badgeVariants({ variant: 'accent' });
  assert.match(cls, /var\(--live\)/, 'accent variant derives its color from --live, not --accent');
});
