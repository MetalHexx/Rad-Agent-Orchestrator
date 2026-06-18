import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.join(process.cwd(), 'components', 'observability', 'help-panel.tsx'), 'utf-8');

test('help panel reuses the house Sheet and MarkdownRenderer, not a new panel (AD-9, FR-13)', () => {
  assert.match(src, /@\/components\/ui\/sheet/, 'reuses the shadcn Sheet primitive');
  assert.match(src, /markdown-renderer/, 'reuses the house MarkdownRenderer');
  assert.match(src, /OBSERVABILITY_HELP_MD/, 'renders the markdown help content');
});
