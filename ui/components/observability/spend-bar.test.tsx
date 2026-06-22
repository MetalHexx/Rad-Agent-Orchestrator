import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpendBar } from './spend-bar';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

// Fill width = total / scaleMax; segment widths = seg.tokens / total; colors via var(--model-*) (FR-6, NFR-2).
{
  const html = renderToStaticMarkup(createElement(SpendBar, {
    segments: [{ model: 'opus', tokens: 75 }, { model: 'haiku', tokens: 25 }],
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

console.log('\nAll SpendBar tests passed');
