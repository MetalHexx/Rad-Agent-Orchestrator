import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'artifact-viewer-modal.tsx'), 'utf-8');

test('artifact viewer is composed from the shared ModalShell (FR-2)', () => {
  assert.match(src, /from ['"]@\/components\/modal\/modal-shell['"]/, 'imports ModalShell');
  assert.match(src, /<ModalShell/, 'renders chrome via ModalShell');
});

test('artifact viewer keeps its own domain pieces (FR-2)', () => {
  assert.match(src, /BufferedStage/, 'still owns the buffered stage');
  assert.match(src, /buildDocDeepLink/, 'still owns share-link construction');
  assert.match(src, /onShare=/, 'passes its share handler into the shell');
});
