import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilteredBadge } from './filtered-badge';
(globalThis as unknown as { React: typeof React }).React = React;

test('renders "Filtered" with the filter icon when active (FR-10, DD-3)', () => {
  const html = renderToStaticMarkup(createElement(FilteredBadge, { active: true }));
  assert.ok(html.includes('Filtered'), 'shows the label');
  assert.ok(html.includes('svg'), 'shows a leading icon');
});

test('renders nothing when not filtered (FR-10)', () => {
  assert.equal(renderToStaticMarkup(createElement(FilteredBadge, { active: false })), '');
});
