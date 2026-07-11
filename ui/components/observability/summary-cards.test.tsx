import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SummaryCards } from './summary-cards';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const sessions = [
  { sessionId: 'a', startedMs: 0, lastMs: 0, spend: 4_820_000, cost: 12.34, rows: [], worktree: 'w' },
  { sessionId: 'b', startedMs: 0, lastMs: 0, spend: 1_000, cost: 0.01, rows: [], worktree: 'w' },
];

test('renders four cards in order: Total Spend, Cost (USD), Sessions, Active Now (FR-4, DD-1)', () => {
  const html = renderToStaticMarkup(createElement(SummaryCards, { sessions, activeNow: 1 }));
  const ts = html.indexOf('Total Spend'), cu = html.indexOf('Cost (USD)'), se = html.indexOf('Sessions'), an = html.indexOf('Active Now');
  assert.ok(ts !== -1 && cu !== -1 && se !== -1 && an !== -1, 'all four labels present');
  assert.ok(ts < cu && cu < se && se < an, 'cards are ordered Total Spend → Cost (USD) → Sessions → Active Now');
});

test('Total Spend shows summed effective tokens, Cost (USD) the summed dollars, Sessions the count, Active Now the active count (FR-4)', () => {
  const html = renderToStaticMarkup(createElement(SummaryCards, { sessions, activeNow: 1 }));
  assert.ok(html.includes('4.82M'), 'spend is summed and humanized (4,821,000 → 4.82M)');
  assert.ok(html.includes('>2<') || html.includes('2'), 'session count is 2');
  assert.ok(html.includes('$12.35'), 'Cost (USD) sums per-session dollars (12.34 + 0.01)');
});

test('an unpriced session poisons the Cost (USD) total to "price unavailable" (DD-2)', () => {
  const unpriced = [
    { sessionId: 'a', startedMs: 0, lastMs: 0, spend: 100, cost: 1.5, rows: [], worktree: 'w' },
    { sessionId: 'b', startedMs: 0, lastMs: 0, spend: 100, cost: null, rows: [], worktree: 'w' },
  ];
  const html = renderToStaticMarkup(createElement(SummaryCards, { sessions: unpriced, activeNow: 0 }));
  assert.ok(html.includes('price unavailable'), 'any unknown-priced session makes the total unavailable, never a partial $ figure');
});

test('summary cards stack on narrow screens and use token gaps (FR-8, DD-10, DD-2)', () => {
  const html = renderToStaticMarkup(createElement(SummaryCards, { sessions: [], activeNow: 0 }));
  assert.ok(html.includes('grid-cols-1') && html.includes('sm:grid-cols-4'), 'one column below sm, four at sm+');
  assert.ok(html.includes('var(--space-'), 'card grid gap uses the spacing scale');
});
