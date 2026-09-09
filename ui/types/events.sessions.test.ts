import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES } from './events';

test('sessions_change is a registered SSE event type so the client auto-subscribes', () => {
  assert.ok(EVENT_TYPES.includes('sessions_change' as never), 'EVENT_TYPES carries sessions_change');
});
