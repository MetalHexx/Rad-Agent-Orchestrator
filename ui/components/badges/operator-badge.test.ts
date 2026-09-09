import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperatorBadge } from './operator-badge';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('renders "Operator" as the visible label', () => {
  const html = renderToStaticMarkup(createElement(OperatorBadge));
  assert.match(html, />Operator</);
});

test('accessible name reads "Operator-requested corrective"', () => {
  const html = renderToStaticMarkup(createElement(OperatorBadge));
  assert.match(html, /aria-label="Operator-requested corrective"/);
});

test('does not carry the corrective group\'s failure-tinted CSS variables', () => {
  const html = renderToStaticMarkup(createElement(OperatorBadge));
  assert.doesNotMatch(html, /--status-failed/);
  assert.doesNotMatch(html, /--color-warning/);
});
