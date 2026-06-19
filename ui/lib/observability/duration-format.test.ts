import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from './duration-format';

test('formats wall-clock spans human-friendly (FR-9)', () => {
  assert.equal(formatDuration(45 * 60 * 1000), '45m');
  assert.equal(formatDuration((2 * 60 + 14) * 60 * 1000), '2h 14m');
  assert.equal(formatDuration((3 * 24 * 60 + 60) * 60 * 1000), '3d 1h');
  assert.equal(formatDuration(30 * 1000), '<1m');
});
