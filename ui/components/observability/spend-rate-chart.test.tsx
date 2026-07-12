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

test('default view shows every model line — visibility is an opt-OUT `hidden` set seeded empty (FR-4)', () => {
  assert.ok(/DEFAULT_HIDDEN_KEYS/.test(src), 'seeds the hidden set from DEFAULT_HIDDEN_KEYS (empty — nothing hidden)');
  assert.ok(/hide=\{hidden\.has\(/.test(src), "each Area's hide is driven by the opt-out `hidden` set");
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

test('newly-arrived model lines never flash hidden: visibility is derived at render, not patched by a post-paint effect (FR-4, FR-7)', () => {
  // A [series]-keyed effect that re-seeded `hidden` AFTER paint would risk a late-arriving model
  // flashing hidden for one frame before showing. Visibility is instead a pure render-time
  // function of (series, hidden) via visibleSeriesKeys — a live-tail model that first appears is
  // absent from `hidden` (which only grows from an explicit legend click), so it renders visible
  // on its very first frame.
  assert.ok(/visibleSeriesKeys\(/.test(src), 'derives the visible keys via the pure visibleSeriesKeys helper at render');
  assert.ok(!/}\s*,\s*\[\s*series\s*\]\s*\)/.test(src), 'no [series]-keyed effect re-derives hidden state after mount');
});

test('models the user hides are tracked in a `hidden` state, not re-derived from series (FR-4, FR-7)', () => {
  // Hides live in component state that only changes on a legend click, so a later live-tail
  // series update neither un-hides a user-hidden model nor hides a newly-arrived one.
  assert.ok(/setHidden\(/.test(src), 'legend toggle flips membership in the `hidden` opt-out state');
  assert.ok(/useState<Set<string>>/.test(src), 'the hidden set is component state (survives re-renders)');
});

test('chart holds until data is ready, then fades in — no flat-axis flash on load (smooth-load)', () => {
  // On first load the hook hasn't backfilled yet; rather than paint a flat default axis and pop
  // the data in a frame later, the chart reserves its slot while !ready and reveals the populated
  // chart with a one-shot fade once `ready` flips true.
  assert.match(src, /ready/, 'accepts/uses a `ready` prop to gate rendering');
  assert.match(src, /\{\s*ready\s*\?/, 'renders the chart only on the ready branch (reserved placeholder while loading)');
  assert.match(src, /animate-in fade-in/, 'reveals the ready chart with a fade-in transition');
});

test('spend-rate chart X-axis clips to its explicit domain (FR-1, DD-8)', () => {
  // The axis must declare the range-bounded domain AND opt into clipping, so snapped
  // since-range zero-buckets that fall before rangeStart scroll off the left edge
  // instead of expanding the rendered domain and smooshing the data to the right.
  assert.match(src, /domain=\{\[rangeStart, rangeEnd\]\}/, 'X-axis keeps the raw-bounds domain');
  assert.match(src, /allowDataOverflow/, 'X-axis opts into data-overflow clipping');
});
