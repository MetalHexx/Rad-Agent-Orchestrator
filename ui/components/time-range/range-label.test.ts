// ui/components/time-range/range-label.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangePillLabel } from './range-label';

test('relative shows its preset label (FR-3, DD-1)', () => {
  assert.equal(rangePillLabel({ kind: 'relative', preset: '24h' }), 'Last 24 hours');
});

test('new preset labels are correct (FR-3)', () => {
  assert.equal(rangePillLabel({ kind: 'relative', preset: '3h' }), 'Last 3 hours');
  assert.equal(rangePillLabel({ kind: 'relative', preset: '12h' }), 'Last 12 hours');
  assert.equal(rangePillLabel({ kind: 'relative', preset: '2d' }), 'Last 2 days');
});

test('since shows "<start> → Now"; absolute shows "<start> → <end>" (DD-1)', () => {
  const start = Date.parse('2026-06-18T10:00:00Z');
  const end = Date.parse('2026-06-19T10:00:00Z');
  assert.match(rangePillLabel({ kind: 'since', startMs: start }), / → Now$/);
  assert.match(rangePillLabel({ kind: 'absolute', startMs: start, endMs: end }), / → (?!Now$).+$/);
});
