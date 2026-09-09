import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AmendmentBadge } from './amendment-badge';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('renders "Amendment {index}" as the visible label', () => {
  const html = renderToStaticMarkup(createElement(AmendmentBadge, { index: 1 }));
  assert.match(html, />Amendment 1</);
});

test('accessible name reads "Amendment {index}"', () => {
  const html = renderToStaticMarkup(createElement(AmendmentBadge, { index: 1 }));
  assert.match(html, /aria-label="Amendment 1"/);
});

test('names a second amendment distinctly from the first', () => {
  const html = renderToStaticMarkup(createElement(AmendmentBadge, { index: 2 }));
  assert.match(html, />Amendment 2</);
  assert.match(html, /aria-label="Amendment 2"/);
});

test('does not carry the corrective group\'s failure-tinted CSS variables', () => {
  const html = renderToStaticMarkup(createElement(AmendmentBadge, { index: 1 }));
  assert.doesNotMatch(html, /--status-failed/);
  assert.doesNotMatch(html, /--color-warning/);
});

test('carries the --model-teal provenance tint and not the shared --live variable', () => {
  const html = renderToStaticMarkup(createElement(AmendmentBadge, { index: 1 }));
  assert.match(html, /--model-teal/);
  assert.doesNotMatch(html, /--live/);
});
