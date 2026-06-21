import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.join(process.cwd(), 'components', 'observability', 'spend-rate-chart.tsx'), 'utf-8');

test('is a multi-series LineChart titled from the title prop, with a Legend (FR-1, DD-4)', () => {
  assert.ok(src.includes('LineChart') && src.includes('<Line'), 'uses a recharts LineChart/Line');
  assert.ok(src.includes('{title}'), 'renders the title prop, not a hardcoded title');
  assert.ok(!src.includes('Total Rate'), 'old hardcoded "Total Rate" title is gone (DD-4)');
  assert.ok(src.includes('Legend'), 'has a legend (multi-series)');
});

test('renders one Line per series entry — no hardcoded model list (FR-2, NFR-1)', () => {
  assert.ok(/series\.map\(/.test(src), 'maps over the series descriptor to render lines');
  assert.ok(!/dataKey="(opus|sonnet|haiku)"/.test(src), 'no hardcoded model dataKeys');
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

test('Y domain uses the stable niceMax over the visible series only (FR-5, FR-3)', () => {
  assert.ok(src.includes('niceMax') && /visibleKeys/.test(src), 'niceMax is fed the visible series');
});
