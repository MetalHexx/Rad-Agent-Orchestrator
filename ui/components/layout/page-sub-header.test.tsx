import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageSubHeader } from './page-sub-header';
import * as barrel from './index';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('PageSubHeader is exported from the module and the barrel (AD-7)', () => {
  assert.equal(typeof PageSubHeader, 'function');
  assert.equal(typeof (barrel as Record<string, unknown>).PageSubHeader, 'function');
});

test('renders the band chrome and token-based cluster gap, no hardcoded px (DD-3, NFR-3)', () => {
  const html = renderToStaticMarkup(createElement(PageSubHeader, {
    ariaLabel: 'Demo page', title: 'Title', subtitle: 'Sub',
    actions: createElement('button', null, 'A'),
  }));
  assert.ok(html.includes('border-b border-border px-6 py-3'), 'band chrome present');
  assert.ok(html.includes('gap-[var(--space-4)]'), 'cluster gap uses the --space-4 token');
  assert.ok(html.includes('sm:ml-auto'), 'actions cluster right-aligns from sm up');
  assert.ok(html.includes('aria-label="Demo page"'), 'aria-label applied');
});
