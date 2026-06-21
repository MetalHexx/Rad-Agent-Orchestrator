import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// @base-ui/react Dialog portals do not render in SSR (renderToStaticMarkup returns
// empty string) because FloatingPortal appends to document.body which is absent in
// Node.js SSR. Source inspection is the established pattern for Dialog/Sheet-backed
// components in this codebase (see instruction-drawer.test.tsx, unsaved-changes-dialog.test.tsx).

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'help-panel.tsx'), 'utf-8');

test('defaults preserve the All-Sessions title (FR-7, DD-9)', () => {
  // The title prop must default to "About this page" so All-Sessions usage is unchanged.
  assert.match(src, /title\s*=\s*["']About this page["']/, 'default title unchanged');
});

test('accepts an overridden title and content (FR-7, DD-9)', () => {
  // The component must declare optional title? and content? props.
  assert.match(src, /title\?:\s*string/, 'title? prop declared');
  assert.match(src, /content\?:\s*string/, 'content? prop declared');
  // Title and content must be rendered (not hardcoded).
  assert.match(src, /\{title\}/, 'title variable rendered in JSX');
  assert.match(src, /content=\{content\}|content:\s*content/, 'content variable passed to renderer');
});
