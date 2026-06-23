import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'route.ts'), 'utf-8');
test('route constructs the runtime with a transcripts root (AD-8)', () => {
  assert.match(src, /transcriptsRoot/, 'route passes a transcriptsRoot to the runtime');
});
test('route subscribes to transcripts and emits transcript_change (FR-10, AD-3)', () => {
  assert.match(src, /subscribeTranscripts/, 'route subscribes via subscribeTranscripts');
  assert.match(src, /createSSEEvent\(\s*['"]transcript_change['"]/, 'route enqueues a transcript_change event');
});
