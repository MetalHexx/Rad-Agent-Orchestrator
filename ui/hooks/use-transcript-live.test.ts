import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptChangeMatches } from './use-transcript-live';
import type { SSEEvent } from '@/types/events';

const ev = (type: string, sessionId?: string): SSEEvent =>
  ({ type, timestamp: 't', payload: sessionId ? { sessionId, kind: 'changed' } : {} } as never);

test('matches a transcript_change for the open session (FR-11, AD-4)', () => {
  assert.equal(transcriptChangeMatches(ev('transcript_change', 'sess-1'), 'sess-1'), true);
});
test('ignores other sessions and other event types (FR-11, NFR-7)', () => {
  assert.equal(transcriptChangeMatches(ev('transcript_change', 'sess-2'), 'sess-1'), false);
  assert.equal(transcriptChangeMatches(ev('telemetry_rows'), 'sess-1'), false);
});
