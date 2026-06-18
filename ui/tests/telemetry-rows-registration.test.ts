import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES } from '../types/events';

test('telemetry_rows is a registered SSE event type so the browser keeps it (FR-14)', () => {
  assert.ok(EVENT_TYPES.includes('telemetry_rows'));
});
