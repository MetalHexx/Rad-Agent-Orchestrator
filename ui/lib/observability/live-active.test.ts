import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countActiveNow } from './live-active';

const now = Date.parse('2026-06-19T12:00:00Z');
const sess = (id: string, lastIso: string) => ({ sessionId: id, startedMs: 0, lastMs: Date.parse(lastIso), spend: 0, rows: [] });

test('counts sessions active in the decay window, system-wide — not the analyzed window (FR-9, AD-7)', () => {
  const todaySessions = [
    sess('a', '2026-06-19T11:59:00Z'), // active (1m ago)
    sess('b', '2026-06-19T11:00:00Z'), // idle (1h ago)
  ];
  assert.equal(countActiveNow(todaySessions, now), 1);
});
