import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolCallsControls } from './tool-calls-controls';
Object.assign(globalThis, { React });

const noop = () => {};
const base = {
  errorsOnly: false, onErrorsOnly: noop, toolFilter: null, onToolFilter: noop,
  toolNames: ['Read', 'Bash'], query: '', onQuery: noop,
};

test('renders the four controls with labels, placeholder, and the showing count (FR-6, DD-6)', () => {
  const html = renderToStaticMarkup(createElement(ToolCallsControls, { ...base, shown: 3, total: 7 } as never));
  assert.ok(html.includes('Errors only'), 'errors-only label');
  assert.ok(html.includes('Tool'), 'tool filter label');
  assert.ok(html.includes('Search inputs'), 'search placeholder');
  assert.ok(html.includes('showing 3 of 7'), 'post-filter count');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-3)');
});
