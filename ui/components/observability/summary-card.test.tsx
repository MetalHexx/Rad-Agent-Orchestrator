import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SummaryCard, SummaryCardGrid, TotalSpendCard } from './summary-card';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('SummaryCard renders label, value, and tooltip (DD-3)', () => {
  const html = renderToStaticMarkup(
    createElement(SummaryCard, { label: 'Widgets', value: 7, tooltip: 'how many widgets' })
  );
  assert.ok(html.includes('Widgets'), 'label present');
  assert.ok(html.includes('7'), 'value present');
  assert.ok(html.includes('how many widgets'), 'tooltip present');
  assert.ok(html.includes('rounded-xl') && html.includes('text-3xl'), 'shared tile styling present');
});

test('TotalSpendCard renders the shared Token Spend label, humanized spend, no dollars (FR-2)', () => {
  const html = renderToStaticMarkup(createElement(TotalSpendCard, { spend: 4_820_000 }));
  assert.ok(html.includes('Token Spend'), 'label is Token Spend');
  assert.ok(html.includes('4.82M'), 'spend humanized via the shared card');
  assert.ok(!html.includes('$'), 'no dollar cost');
});

test('SummaryCardGrid stacks on narrow screens and parameterizes the column count (AD-4)', () => {
  const three = renderToStaticMarkup(createElement(SummaryCardGrid, { columns: 3 }));
  assert.ok(three.includes('grid-cols-1') && three.includes('sm:grid-cols-3'), 'one col below sm, three at sm+');
  assert.ok(three.includes('var(--space-'), 'gap uses the spacing scale');
  const four = renderToStaticMarkup(createElement(SummaryCardGrid, { columns: 4 }));
  assert.ok(four.includes('sm:grid-cols-4'), 'column count is parameterized (4 → sm:grid-cols-4)');
});
