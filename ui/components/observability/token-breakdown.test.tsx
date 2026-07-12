import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenBreakdown } from './token-breakdown';
Object.assign(globalThis, { React });

test('renders the four labeled counts in order, each with its price weight, and an info tooltip trigger (FR-1, FR-2, DD-2)', () => {
  const html = renderToStaticMarkup(createElement(TokenBreakdown, {
    input: 12_300, output: 4_000, cacheRead: 1_000_000, cacheCreate: 50_000,
  }));
  for (const label of ['Input', 'Output', 'Cache read', 'Cache create']) {
    assert.ok(html.includes(label), `${label} label present`);
  }
  const i = html.indexOf('Input'), o = html.indexOf('Output');
  const cr = html.indexOf('Cache read'), cc = html.indexOf('Cache create');
  assert.ok(i < o && o < cr && cr < cc, 'cells ordered Input → Output → Cache read → Cache create');
  assert.ok(html.includes('12.3K') && html.includes('1.00M') && html.includes('50.0K'),
    'counts rendered via humanizeTokens');
  for (const weight of ['×1', '×5', '×0.1', '×1.25']) {
    assert.ok(html.includes(weight), `${weight} price weight annotated`);
  }
  assert.ok(html.includes('<svg'), 'info icon trigger present');
});

test('never shows the cost-weighted total or a dollar figure — redundant with the Cost (USD) / Token Spend cards above (DD-1)', () => {
  const html = renderToStaticMarkup(createElement(TokenBreakdown, {
    input: 12_300, output: 4_000, cacheRead: 1_000_000, cacheCreate: 50_000,
  }));
  assert.ok(!html.includes('$'), 'no dollar figure rendered here');
  assert.ok(!html.includes('Cost'), 'no Cost (weighted) / Cost (USD) label rendered here');
});

test('the info tooltip states the weighting and points to the cards above for totals', () => {
  // TooltipContent portals into a closed-by-default popup, which renderToStaticMarkup does not
  // emit (see overview-facet.test.tsx's identical note) — verify the tooltip copy at the source.
  const src = fs.readFileSync(
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'token-breakdown.tsx'), 'utf8');
  assert.match(src, /weighted by relative cost/, 'tooltip covers the weighting');
  assert.match(src, /Token Spend/, 'tooltip points to the Token Spend card for the weighted total');
});

test('reads as a muted footnote, never a headline (DD-1)', () => {
  const html = renderToStaticMarkup(createElement(TokenBreakdown, {
    input: 1, output: 1, cacheRead: 1, cacheCreate: 1,
  }));
  assert.ok(!html.includes('text-3xl'), 'no headline sizing');
  assert.ok(html.includes('text-xs'), 'uses xs footnote text');
  assert.ok(html.includes('text-muted-foreground'), 'uses muted foreground');
});

test('renders inside a card shell matching the house card pattern', () => {
  const html = renderToStaticMarkup(createElement(TokenBreakdown, {
    input: 1, output: 1, cacheRead: 1, cacheCreate: 1,
  }));
  assert.ok(html.includes('rounded-xl'), 'card has rounded corners');
  assert.ok(html.includes('bg-card'), 'card has card background');
  assert.ok(html.includes('ring-1'), 'card has ring border');
});
