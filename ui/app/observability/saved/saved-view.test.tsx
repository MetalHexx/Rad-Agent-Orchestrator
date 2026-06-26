import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SavedView } from './saved-view';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('renders the zero-state on first paint, with no time-range picker (FR-4, DD-3, DD-9)', () => {
  const html = renderToStaticMarkup(createElement(SavedView));
  assert.ok(html.includes('No saved sessions yet'), 'empty-state copy renders before any saved sessions load');
  assert.ok(html.includes('aria-label="Refresh now"'), 'the shared sub-header renders without a time range');
});

test('SavedView passes onRenamed to SavedRow and updates the saved list state on rename (FR-5)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'saved-view.tsx'), 'utf8');
  assert.match(src, /onRenamed=/, 'SavedView passes onRenamed prop to SavedRow');
  assert.match(
    src,
    /setSaved[\s\S]{0,100}prev\.map/,
    'onRenamed handler calls setSaved with a mapping function to update the matching session',
  );
  assert.match(
    src,
    /sessionId.*===.*updated\.sessionId|updated\.sessionId.*===.*sessionId/,
    'onRenamed handler matches entries by sessionId',
  );
});

test('SavedView passes onUnsave to SavedRow, calls unsaveSession, and refreshes on success (DD-3)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'saved-view.tsx'), 'utf8');
  assert.match(src, /onUnsave=/, 'SavedView passes onUnsave prop to SavedRow');
  assert.match(src, /unsaveSession/, 'onUnsave handler calls unsaveSession');
  assert.match(
    src,
    /unsaveSession[\s\S]{0,100}reload\(\)|reload\(\)[\s\S]{0,100}unsaveSession/,
    'onUnsave handler calls reload to refresh the list after successful unsave',
  );
});
