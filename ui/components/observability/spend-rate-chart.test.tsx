import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.join(process.cwd(), 'components', 'observability', 'spend-rate-chart.tsx'), 'utf-8');

test('is a multi-series AreaChart titled from the title prop, with a Legend (FR-1, DD-4)', () => {
  assert.ok(src.includes('AreaChart') && src.includes('<Area'), 'uses a recharts AreaChart/Area');
  assert.ok(src.includes('{title}'), 'renders the title prop, not a hardcoded title');
  assert.ok(!src.includes('Total Rate'), 'old hardcoded "Total Rate" title is gone (DD-4)');
  assert.ok(src.includes('Legend'), 'has a legend (multi-series)');
});

test('renders one Area per series entry — no hardcoded model list (FR-2, NFR-1)', () => {
  assert.ok(/series\.map\(/.test(src), 'maps over the series descriptor to render areas');
  assert.ok(!/dataKey="(opus|sonnet|haiku)"/.test(src), 'no hardcoded model dataKeys');
});

test('each Area has a hard stroke over a per-series soft-fade gradient fill (regression: blue fade)', () => {
  // Restores the original AreaChart look: a 2px stroke (hard line) on top of a vertical
  // linearGradient that fades to transparent — one gradient per series, keyed to its token.
  assert.ok(src.includes('<defs'), 'defines gradient defs');
  assert.ok(src.includes('linearGradient'), 'uses a linearGradient fill');
  assert.ok(src.includes('url(#spend-fill-'), 'each Area fills from its own per-series gradient id');
  assert.ok(src.includes('strokeWidth={2}'), 'keeps the 2px hard stroke line');
  assert.ok(/stopOpacity=\{0\.85\}/.test(src), 'top stop is the original 0.85 opacity');
  assert.ok(/stopOpacity=\{0\.32\}/.test(src), 'mid stop is the original 0.32 opacity');
  assert.ok(/stopOpacity=\{0\}/.test(src), 'bottom stop fades fully to transparent');
});

test('default view is total-only — non-total lines start hidden (FR-4)', () => {
  assert.ok(/key\s*!==\s*["']total["']/.test(src), 'seeds the hidden set with non-total keys');
  assert.ok(/hide=\{hidden\./.test(src), "each Line's hide is driven by the hidden set");
});

test('legend click toggles series via onClick(dataKey) + inactive greying (FR-5, AD-4, DD-3)', () => {
  assert.ok(src.includes('onClick') && src.includes('dataKey'), 'legend onClick keyed on dataKey');
  assert.ok(src.includes('inactive'), 'toggled-off legend entries marked inactive (greyed)');
});

test('colors come only from series cssVar tokens — no inline hex/oklch/hsl (NFR-2)', () => {
  assert.ok(src.includes('var(${'), 'stroke/color uses var(${cssVar})');
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(src), 'no inline hex colors');
  assert.ok(!/\b(oklch|hsl)\(/.test(src), 'no inline oklch/hsl colors');
});

test('Y axis fits the visible series tightly via niceAxis (FR-5, FR-3)', () => {
  assert.ok(/niceAxis\(/.test(src), 'uses the niceAxis helper (tight nice-step ceiling + integer fallback)');
  assert.ok(/visibleKeys/.test(src), 'still fits the visible (un-hidden) series — fit-to-visible, FR-5');
  assert.ok(!/niceMax\(/.test(src), 'no longer uses the coarse niceMax round-up directly');
});

test('late-arriving models start hidden too — FR-4 holds under SSE live-tail (FR-4, FR-7)', () => {
  // The one-time mount seed is not enough: observability-view recomputes `series` on every
  // SSE tick, so a model that first appears after mount must also be seeded into `hidden`.
  assert.ok(/useEffect\(/.test(src), 'reacts to series changes via an effect');
  assert.ok(/}\s*,\s*\[\s*series\s*\]\s*\)/.test(src), 'the effect is keyed on [series]');
  assert.ok(/setHidden\(/.test(src), 'the effect seeds newly-arrived keys into the hidden set');
});

test('models the user opted in are not re-hidden by later series updates (FR-4, FR-7)', () => {
  // Seeding must key off keys never-before-seen, not "every key not currently hidden", or a
  // user-shown model would be re-hidden on the next live-tail tick.
  assert.ok(/seen/i.test(src), 'tracks which non-total keys have already been seen');
  assert.ok(/useRef/.test(src), 'the seen-ledger is a ref so it survives re-renders');
});
