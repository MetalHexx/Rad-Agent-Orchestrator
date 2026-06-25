import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenBreakdown } from './token-breakdown';
Object.assign(globalThis, { React });

test('renders the four labeled counts in order plus the fold-into-Spend note (FR-1, FR-2, DD-2)', () => {
  const html = renderToStaticMarkup(createElement(TokenBreakdown, {
    input: 12_300, output: 4_000, cacheRead: 1_000_000, cacheCreate: 50_000, spend: 4_820_000,
  }));
  for (const label of ['Input', 'Output', 'Cache read', 'Cache create']) {
    assert.ok(html.includes(label), `${label} label present`);
  }
  const i = html.indexOf('Input'), o = html.indexOf('Output');
  const cr = html.indexOf('Cache read'), cc = html.indexOf('Cache create');
  assert.ok(i < o && o < cr && cr < cc, 'cells ordered Input → Output → Cache read → Cache create');
  assert.ok(html.includes('12.3K') && html.includes('1.00M') && html.includes('50.0K'),
    'counts rendered via humanizeTokens');
  assert.ok(html.includes('Folds into Total Spend 4.82M'), 'note names the formatted spend');
});

test('reads as a muted footnote, never a headline (DD-1)', () => {
  const html = renderToStaticMarkup(createElement(TokenBreakdown, {
    input: 1, output: 1, cacheRead: 1, cacheCreate: 1, spend: 1,
  }));
  assert.ok(!html.includes('text-3xl'), 'no headline sizing');
  assert.ok(html.includes('text-xs'), 'uses xs footnote text');
  assert.ok(html.includes('text-muted-foreground'), 'uses muted foreground');
});
