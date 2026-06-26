import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ViewSwitcher } from './view-switcher';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('renders both segments, the live saved count, and the active marker (FR-8, DD-8)', () => {
  const html = renderToStaticMarkup(createElement(ViewSwitcher, { active: 'saved', savedCount: 4 }));
  assert.ok(html.includes('All Sessions'), 'all-sessions segment present');
  assert.ok(html.includes('Saved'), 'saved segment present');
  assert.ok(html.includes('· 4'), 'live saved count rendered');
  assert.ok(html.includes('aria-selected="true"'), 'active segment marked');
});
