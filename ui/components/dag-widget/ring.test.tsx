import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ring, clampRingValue } from './ring';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

// ─── clampRingValue ──────────────────────────────────────────────────────────

test('clampRingValue keeps an in-range value untouched', () => {
  assert.equal(clampRingValue(3, 10), 3);
});

test('clampRingValue caps a value above max', () => {
  assert.equal(clampRingValue(14, 10), 10);
});

test('clampRingValue floors negatives and non-finite input to zero', () => {
  assert.equal(clampRingValue(-2, 10), 0);
  assert.equal(clampRingValue(Number.NaN, 10), 0);
});

test('clampRingValue returns zero when max is non-positive', () => {
  assert.equal(clampRingValue(5, 0), 0);
});

// ─── render distinctness + fixed geometry ────────────────────────────────────

function render(props: React.ComponentProps<typeof Ring>): string {
  return renderToStaticMarkup(createElement(Ring, props));
}

test('determinate mode renders a recharts svg arc and no conic sweep', () => {
  const html = render({ value: 4, max: 10, color: 'var(--tier-execution)', mode: 'determinate', children: '4' });
  assert.match(html, /<svg/, 'determinate ring draws an svg arc');
  assert.ok(!html.includes('conic-gradient'), 'determinate ring has no conic sweep');
  assert.ok(html.includes('>4<'), 'center children rendered');
});

test('indeterminate mode renders a rotating conic sweep, not an svg arc', () => {
  const html = render({ value: 0, max: 1, color: 'var(--tier-review)', mode: 'indeterminate', children: '•' });
  assert.ok(html.includes('conic-gradient'), 'indeterminate ring uses a conic sweep');
  assert.match(html, /animate-spin/, 'indeterminate sweep rotates via animate-spin');
  assert.ok(!html.includes('<svg'), 'indeterminate ring draws no svg arc');
});

test('both modes occupy the identical fixed diameter', () => {
  const det = render({ value: 4, max: 10, color: 'var(--tier-execution)', mode: 'determinate' });
  const indet = render({ value: 0, max: 1, color: 'var(--tier-review)', mode: 'indeterminate' });
  const size = /width:\s*72px;\s*height:\s*72px/;
  assert.match(det, size, 'determinate ring is 72px square');
  assert.match(indet, size, 'indeterminate ring is 72px square');
});
