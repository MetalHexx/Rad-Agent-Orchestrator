import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeVariants } from './badge';

test('the accent variant is house-purple, backed by the --live token (DD-3)', () => {
  const cls = badgeVariants({ variant: 'accent' });
  assert.match(cls, /var\(--live\)/, 'accent variant derives its color from --live, not --accent');
});

test('success variant is green, backed by --model-green, no literal hex (FR-8, DD-2)', () => {
  const cls = badgeVariants({ variant: 'success' });
  assert.ok(cls.includes('--model-green'), 'uses the model-green token');
  assert.ok(cls.includes('color-mix'), 'tinted fill via color-mix, mirroring the accent variant');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(cls), 'no literal hex (NFR-3)');
});

test('destructive stays the red status variant for errors (FR-8, DD-3)', () => {
  assert.ok(badgeVariants({ variant: 'destructive' }).includes('text-destructive'));
});
