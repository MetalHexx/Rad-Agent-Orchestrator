import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpendBar } from './spend-bar';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

// Fill width = total / scaleMax; segment widths = seg.tokens / total; colors via var(--model-*) (FR-6, NFR-2).
{
  const html = renderToStaticMarkup(createElement(SpendBar, {
    segments: [{ model: 'opus', tokens: 75, dollars: 9.43 }, { model: 'haiku', tokens: 25, dollars: 1.24 }],
    total: 100, scaleMax: 200,
  }));
  assert.ok(html.includes('width:50%'), 'fill width is total/scaleMax');
  assert.ok(html.includes('var(--model-red)'), 'opus segment uses --model-red token');
  assert.ok(html.includes('var(--model-green)'), 'haiku segment uses --model-green token');
  assert.ok(html.includes('transition-[width]'), 'bar carries a width transition for live growth (NFR-5)');
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(html), 'no literal hex color in markup (NFR-2)');
  console.log('✓ SpendBar renders proportional model-colored segments');
}

// Zero scaleMax must not divide-by-zero into NaN width.
{
  const html = renderToStaticMarkup(createElement(SpendBar, { segments: [], total: 0, scaleMax: 0 }));
  assert.ok(html.includes('width:0%'), 'zero scaleMax → 0% fill, no NaN');
  console.log('✓ SpendBar guards zero scaleMax');
}

// A mixed-model node renders a per-model dollar split under the bar (Done when).
{
  const html = renderToStaticMarkup(createElement(SpendBar, {
    segments: [{ model: 'opus', tokens: 75, dollars: 9.43 }, { model: 'sonnet', tokens: 25, dollars: 1.24 }],
    total: 100, scaleMax: 200,
  }));
  assert.ok(html.includes('opus') && html.includes('$9.43'), 'opus split entry renders model + dollars');
  assert.ok(html.includes('sonnet') && html.includes('$1.24'), 'sonnet split entry renders model + dollars');
  console.log('✓ SpendBar renders per-model dollar split for mixed models');
}

// A single-model node has nothing to split — no per-model breakdown rendered below the bar.
{
  const html = renderToStaticMarkup(createElement(SpendBar, {
    segments: [{ model: 'opus', tokens: 100, dollars: 5 }],
    total: 100, scaleMax: 200,
  }));
  assert.ok(!html.includes('$5.00'), 'single-model node renders no per-model split');
  console.log('✓ SpendBar renders no split for single-model nodes');
}

// A mixed-model node with an unknown-priced model renders unavailable for that segment, not $0.
{
  const html = renderToStaticMarkup(createElement(SpendBar, {
    segments: [{ model: 'opus', tokens: 50, dollars: 5 }, { model: 'ghost', tokens: 50, dollars: null }],
    total: 100, scaleMax: 200,
  }));
  assert.ok(html.includes('price unavailable'), 'unknown-priced split segment renders unavailable');
  assert.ok(!html.includes('$0.00'), 'never renders $0 for an unpriced split segment');
  console.log('✓ SpendBar split shows unavailable for an unknown-priced model');
}

// Fable segments — in the bar fill and in the per-model split — use the purple house token (Done when).
{
  const html = renderToStaticMarkup(createElement(SpendBar, {
    segments: [{ model: 'opus', tokens: 50, dollars: 5 }, { model: 'fable', tokens: 50, dollars: 20 }],
    total: 100, scaleMax: 200,
  }));
  assert.ok(html.includes('var(--model-purple)'), 'fable segment uses the purple model token');
  assert.ok(html.includes('fable') && html.includes('$20.00'), 'fable split entry renders model + dollars');
  console.log('✓ SpendBar colors Fable segments purple');
}

console.log('\nAll SpendBar tests passed');
