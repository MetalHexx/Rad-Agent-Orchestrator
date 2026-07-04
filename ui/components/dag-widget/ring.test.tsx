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

// ─── rendered geometry (fills the 72px box, not just a 72px prop) ───────────

/**
 * recharts bakes the arc's actual radii into the sector `<path>`'s `d`
 * attribute at render time (pure math, independent of browser layout), so
 * even a server-rendered string carries the true rendered geometry — unlike
 * a CSS width/height, which SSR can't verify without a real layout engine.
 * Extracts the two `A r,r,0 ...` elliptical-arc radii recharts' `Sector`
 * emits for a full-circle background band: the larger is the outer edge,
 * the smaller the inner edge.
 */
function extractSectorRadii(html: string): { outer: number; inner: number } {
  const match = html.match(/recharts-radial-bar-background-sector"[^>]*\sd="([^"]+)"/);
  assert.ok(match, 'background sector path renders with a d attribute');
  const radii = Array.from(match![1].matchAll(/A\s*([\d.]+),([\d.]+),0/g)).map((m) => Number(m[1]));
  assert.ok(radii.length >= 2, 'background sector path carries an outer and inner arc radius');
  return { outer: Math.max(...radii), inner: Math.min(...radii) };
}

test('determinate ring geometry fills the 72px box: outer edge at the box radius, band at the shared stroke fraction', () => {
  const html = render({ value: 4, max: 10, color: 'var(--tier-execution)', mode: 'determinate' });
  const { outer, inner } = extractSectorRadii(html);
  const boxRadius = 36; // RING_DIAMETER / 2
  const strokeFraction = 0.28; // mirrors ring.tsx's RING_STROKE_FRACTION
  const expectedStroke = Math.round(boxRadius * strokeFraction);
  assert.equal(outer, boxRadius, 'the rendered arc reaches the ring box radius (72px diameter), not a shrunk recharts default');
  assert.equal(outer - inner, expectedStroke, 'the band thickness matches RING_STROKE_FRACTION of the box radius');
});

// ─── unified track + stroke ───────────────────────────────────────────────────

test('indeterminate mode renders an underlaid muted full-circle track behind the sweep', () => {
  const html = render({ value: 0, max: 1, color: 'var(--tier-review)', mode: 'indeterminate' });
  assert.ok(html.includes('data-ring-track'), 'indeterminate ring includes a dedicated track element');
  assert.ok(html.includes('var(--muted)'), 'the track is filled with the same muted token the determinate track uses');
});

test('determinate mode also carries the muted track fill', () => {
  const html = render({ value: 4, max: 10, color: 'var(--tier-execution)', mode: 'determinate' });
  assert.ok(html.includes('var(--muted)'), 'determinate track background uses the muted token');
});

test('indeterminate mask stroke matches the determinate band thickness fraction (28% of radius)', () => {
  const html = render({ value: 0, max: 1, color: 'var(--tier-review)', mode: 'indeterminate' });
  // RING_DIAMETER (72) / 2 * 0.28, rounded — kept in lockstep with determinate's innerRadius via one shared fraction.
  assert.ok(html.includes('10px'), 'indeterminate stroke resolves from the shared RING_STROKE_FRACTION');
});

// ─── sublabel ─────────────────────────────────────────────────────────────────

test('sublabel renders as a muted small-caps line beneath the center children when provided', () => {
  const html = render({
    value: 4,
    max: 10,
    color: 'var(--tier-execution)',
    mode: 'determinate',
    children: '4',
    sublabel: 'TASK',
  });
  assert.ok(html.includes('>4<'), 'primary center content still renders');
  assert.ok(html.includes('>TASK<'), 'sublabel text renders');
  assert.match(html, /uppercase[^"]*"[^>]*>TASK</, 'sublabel is styled small-caps/uppercase');
});

test('sublabel is omitted entirely when absent', () => {
  const html = render({ value: 4, max: 10, color: 'var(--tier-execution)', mode: 'determinate', children: '4' });
  assert.ok(!html.includes('uppercase'), 'no sublabel markup renders when sublabel is unset');
});
