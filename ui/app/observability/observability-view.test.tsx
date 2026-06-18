import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ObservabilityView } from './observability-view';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('renders the All Sessions toolbar title and subtitle (FR-2)', () => {
  const html = renderToStaticMarkup(createElement(ObservabilityView));
  assert.ok(html.includes('All Sessions'), 'shows the page title');
  assert.ok(html.includes('System-wide token usage'), 'shows the subtitle');
});

test('total-rate chart window tracks the reactive clock (NFR-1)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'observability-view.tsx'), 'utf8');
  assert.match(src, /endMs:\s*now\b/,
    'timeBucketedRate must use the reactive now as endMs');
  assert.doesNotMatch(src, /endMs:\s*Date\.now\(\)/,
    'timeBucketedRate must not use Date.now() as endMs');
});
