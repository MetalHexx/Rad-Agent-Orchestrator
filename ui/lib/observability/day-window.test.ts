import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previousUtcDay, retentionFloorDay, canLoadEarlier } from './day-window';

test('previousUtcDay steps back one UTC partition-date (AD-6)', () => {
  assert.equal(previousUtcDay('2026-06-18'), '2026-06-17');
  assert.equal(previousUtcDay('2026-06-01'), '2026-05-31');
});

test('retention floor is 13 days before today (14-day inclusive window) (AD-6)', () => {
  assert.equal(retentionFloorDay('2026-06-18'), '2026-06-05');
});

test('Earlier is blocked once the window reaches the retention floor (AD-6)', () => {
  assert.equal(canLoadEarlier('2026-06-06', '2026-06-18'), true);
  assert.equal(canLoadEarlier('2026-06-05', '2026-06-18'), false);
});
