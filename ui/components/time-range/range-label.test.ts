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

test('since range label uses 12-hour clock (AM/PM present) (DD-1)', () => {
  const start = Date.parse('2026-06-18T10:00:00Z');
  const label = rangePillLabel({ kind: 'since', startMs: start });
  assert.match(label, /\b(AM|PM)\b/, 'label contains AM or PM token');
});

test('since range label does not use 24-hour bare HH:mm format (DD-1)', () => {
  const start = Date.parse('2026-06-18T10:00:00Z');
  const label = rangePillLabel({ kind: 'since', startMs: start });
  // A bare HH:mm not followed by AM/PM would indicate 24h format slipped through
  assert.doesNotMatch(label, /\d{2}:\d{2}(?!\s*(AM|PM))/i, 'no bare 24h HH:mm without AM/PM suffix');
});
