import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RetryBadge } from './retry-badge';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('renders "Retry {attempt}/{max}" as the visible label', () => {
  const html = renderToStaticMarkup(createElement(RetryBadge, { attempt: 1, max: 2 }));
  assert.match(html, />Retry 1\/2</);
});

test('accessible name reads "Retry attempt {attempt} of {max}"', () => {
  const html = renderToStaticMarkup(createElement(RetryBadge, { attempt: 1, max: 2 }));
  assert.match(html, /aria-label="Retry attempt 1 of 2"/);
});

test('renders the secondary Badge variant regardless of how close attempt is to max', () => {
  const html = renderToStaticMarkup(createElement(RetryBadge, { attempt: 2, max: 2 }));
  assert.match(html, />Retry 2\/2</);
  assert.match(html, /aria-label="Retry attempt 2 of 2"/);
});
