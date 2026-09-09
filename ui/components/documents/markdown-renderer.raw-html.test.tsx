import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownRenderer } from './markdown-renderer';
Object.assign(globalThis, { React });

const CORPUS_PATH = 'docs/dashboard.md';
const ASSET_SRC = '../assets/dashboard-screenshot.png';
const ASSET_ROUTE = `/api/docs/asset?path=${encodeURIComponent('assets/dashboard-screenshot.png')}`;

// The corpus's real pattern: a standalone raw-HTML <img> carrying attributes
// that only mean something once parsed back into the tree (rehype-raw's job).
const IMG_FIXTURE = `# Screenshots

<img src="${ASSET_SRC}" width="340" alt="Dashboard screenshot">
`;

// docs/observability.md and docs/visual-docs.md wrap every screenshot this
// way — a table cell with an alignment/width attribute, and the image itself
// wrapped in an anchor that opens the full-size version.
const TABLE_FIXTURE = `<table>
<tr>
<td width="33%" align="center">
<a href="${ASSET_SRC}"><img src="${ASSET_SRC}" width="200" alt="Dashboard thumbnail"></a>
</td>
</tr>
</table>
`;

function render(content: string, docs?: { corpusPath: string }) {
  return renderToStaticMarkup(createElement(MarkdownRenderer, { content, docs } as never));
}

test('docs mode parses a raw-HTML <img> into a real element with its attributes intact', () => {
  const html = render(IMG_FIXTURE, { corpusPath: CORPUS_PATH });
  assert.match(html, /<img[^>]*\/>/, 'a real <img> element was rendered');
  assert.ok(html.includes('width="340"'), 'width attribute survives sanitize');
  assert.ok(html.includes('alt="Dashboard screenshot"'), 'alt attribute survives sanitize');
  assert.ok(html.includes(`src="${ASSET_ROUTE}"`), 'src rewritten through the asset route');
});

test('docs mode parses the table/td/anchor/img screenshot-wrapper pattern with attributes intact', () => {
  const html = render(TABLE_FIXTURE, { corpusPath: CORPUS_PATH });
  assert.match(html, /<table[^>]*>/, 'table element survives sanitize');
  assert.ok(html.includes('width="33%"'), 'td width attribute survives sanitize');
  assert.ok(/text-align:\s*center/.test(html), 'td align is honored (react-markdown renders it as inline style)');
  assert.ok(html.includes('width="200"'), 'nested img width attribute survives sanitize');
  assert.ok(html.includes('alt="Dashboard thumbnail"'), 'nested img alt attribute survives sanitize');
  assert.ok(html.includes(`src="${ASSET_ROUTE}"`), 'nested img src rewritten through the asset route');
  assert.ok(
    html.includes(`href="${ASSET_ROUTE}"`) && html.includes('target="_blank"') && html.includes('rel="noopener noreferrer"'),
    'the wrapping <a> resolves to the asset route and opens in a new tab, like GitHub does for this pattern',
  );
});

test('the opt-in guard: the same <img> fixture rendered WITHOUT docs mode leaves the raw HTML inert', () => {
  const html = render(IMG_FIXTURE);
  assert.match(html, /<h1[\s>]/, 'surrounding markdown still renders a real heading element');
  assert.ok(html.includes('Screenshots'), 'surrounding markdown text still renders');
  assert.ok(!html.includes('<img'), 'raw HTML img never reaches the tree as a real element');
  assert.ok(!html.includes(ASSET_ROUTE), 'no asset resolution happens outside docs mode');
});

test('the opt-in guard: the same table fixture rendered WITHOUT docs mode leaves the raw HTML inert', () => {
  const html = render(TABLE_FIXTURE);
  assert.ok(!html.includes('<table'), 'raw HTML table never reaches the tree as a real element');
  assert.ok(!html.includes('<img'), 'raw HTML img nested in the table never reaches the tree either');
});
