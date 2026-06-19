// ui/lib/time-range/timezone.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localPartsToUtcMs, utcMsToLocalDateStr, utcMsToLocalTimeStr, utcDateString, localOffsetLabel } from './timezone';

test('local date/time parts round-trip through UTC ms to the minute (AD-10)', () => {
  const ms = Date.parse('2026-06-19T15:30:00Z');
  const back = localPartsToUtcMs(utcMsToLocalDateStr(ms), utcMsToLocalTimeStr(ms));
  assert.equal(Math.floor(back / 60_000), Math.floor(ms / 60_000));
});

test('utcDateString is the UTC calendar day, independent of local tz (FR-13)', () => {
  assert.equal(utcDateString(Date.parse('2026-06-19T23:59:59Z')), '2026-06-19');
});

test('offset label reads "local · UTC±NN" (DD-4)', () => {
  assert.match(localOffsetLabel(Date.parse('2026-06-19T12:00:00Z')), /^local · UTC[+−]\d{2}$/);
});
