// ui/components/time-range/absolute-form.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateForm, formToTimeRange, type AbsoluteForm } from './absolute-form';

const base: AbsoluteForm = {
  startDate: '2026-06-18', startTime: '10:00',
  endMode: 'specific', endDate: '2026-06-19', endTime: '10:00',
  floorMs: Date.parse('2026-06-06T00:00:00Z'),
  nowMs: Date.parse('2026-06-19T12:00:00Z'),
};

test('a complete, ordered, in-range form is valid (FR-4, FR-13)', () => {
  assert.equal(validateForm(base).valid, true);
});

test('From after To is invalid with a hint (DD-5)', () => {
  const r = validateForm({ ...base, startDate: '2026-06-20' });
  assert.equal(r.valid, false);
  assert.match(r.hint!, /after|before|order/i);
});

test('end-mode "now" produces a since range; "specific" produces an absolute range (FR-4)', () => {
  assert.equal(formToTimeRange({ ...base, endMode: 'now' })!.kind, 'since');
  assert.equal(formToTimeRange(base)!.kind, 'absolute');
});

test('a future time is rejected (DD-5)', () => {
  assert.equal(validateForm({ ...base, endDate: '2026-06-30' }).valid, false);
});
