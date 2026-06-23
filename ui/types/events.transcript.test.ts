import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES } from './events';
test('transcript_change is a registered SSE event type so the client auto-subscribes (FR-10, AD-3)', () => {
  assert.ok(EVENT_TYPES.includes('transcript_change' as never), 'EVENT_TYPES carries transcript_change');
});
