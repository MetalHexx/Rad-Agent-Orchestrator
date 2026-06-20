// ui/lib/observability/fit-to-session.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitToSession } from './fit-to-session';

const FLOOR = Date.parse('2026-06-06T00:00:00Z');

test('selecting a session yields a since-range pinned to its (clamped) start (FR-5)', () => {
  const start = Date.parse('2026-06-18T08:00:00Z');
  assert.deepEqual(fitToSession(start, FLOOR), { kind: 'since', startMs: start });
});

test('a session starting before the retention floor clamps to the floor (FR-5, FR-6)', () => {
  assert.deepEqual(fitToSession(FLOOR - 1000, FLOOR), { kind: 'since', startMs: FLOOR });
});
