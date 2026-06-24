import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, toolArgPreview } from './transcript-view';

test('formatClock extracts HH:MM:SS from an ISO timestamp, SSR-safe (DD-3)', () => {
  assert.equal(formatClock('2026-06-24T13:05:09.123Z'), '13:05:09');
  assert.equal(formatClock('not-a-date'), '');
});

test('toolArgPreview takes the first line, trimmed and capped (DD-4)', () => {
  assert.equal(toolArgPreview('  ls -la  \nsecond line'), 'ls -la');
  assert.equal(toolArgPreview(undefined), '');
  assert.ok(toolArgPreview('x'.repeat(200)).length <= 80);
});
