import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SavedView } from './saved-view';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('renders the zero-state on first paint, with no time-range picker (FR-4, DD-3, DD-9)', () => {
  const html = renderToStaticMarkup(createElement(SavedView));
  assert.ok(html.includes('No saved benchmarks yet'), 'empty-state copy renders before any saved benchmarks load');
  assert.ok(html.includes('aria-label="Refresh now"'), 'the shared sub-header renders without a time range');
});
