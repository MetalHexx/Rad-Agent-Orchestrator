import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ObservabilityView } from './observability-view';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('renders the All Sessions toolbar title and subtitle (FR-2)', () => {
  const html = renderToStaticMarkup(createElement(ObservabilityView));
  assert.ok(html.includes('All Sessions'), 'shows the page title');
  assert.ok(html.includes('System-wide token usage'), 'shows the subtitle');
});

test('chart window is range-driven and decoupled from the 1s clock; sections reordered (FR-5, AD-3, DD-3)', () => {
  const html = renderToStaticMarkup(createElement(ObservabilityView));
  const iChart = html.indexOf('Token Spend Rate');
  const iBar = html.indexOf('Worktree');
  const iTable = html.indexOf('Current Rate');
  // SSR order: the Worktree filter lives in the header (rendered first), then the
  // Token Spend Rate chart and Current Rate table follow in <main>: control bar → chart → table (DD-3).
  assert.ok(iBar > -1 && iBar < iChart && iChart < iTable, 'order is control bar → chart → table (DD-3)');
});

test('page container applies token-based vertical rhythm and responsive padding (DD-2, FR-8, DD-10)', () => {
  const html = renderToStaticMarkup(createElement(ObservabilityView));
  assert.ok(html.includes('var(--space-'), 'sections are spaced via the --space-* scale');
  assert.ok(/px-6\b/.test(html) && html.includes('sm:'), 'container padding is responsive (tightens on narrow screens)');
});

test('table/cards include the live tail (FR-9, AD-6, DD-4)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'observability-view.tsx'), 'utf8');
  assert.match(src, /rowsSince\(\[\.\.\.rows\.values\(\)\]\s*,\s*rangeStart\)/, 'table/cards window is lower-bounded to the live tail, not clamped to rangeEnd');
});

test('order is controls → chart → table, with the shared sub-header (DD-2, AD-9, NFR-4)', () => {
  const html = renderToStaticMarkup(createElement(ObservabilityView));
  const iChart = html.indexOf('Token Spend Rate');
  const iBar = html.indexOf('Worktree');
  const iTable = html.indexOf('Current Rate');
  // SSR order: Worktree (header control) precedes the Token Spend Rate chart and Current Rate
  // table in <main>, so the rendered sequence is controls → chart → table (DD-2).
  assert.ok(iBar > -1 && iBar < iChart && iChart < iTable, 'order preserved: controls → chart → table (DD-2)');
});

test('renders SpendRateChart, not the retired TotalRateChart (FR-7)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'observability-view.tsx'), 'utf8');
  assert.ok(src.includes('SpendRateChart'), 'uses the shared SpendRateChart');
  assert.ok(!src.includes('TotalRateChart'), 'TotalRateChart import/usage fully removed');
});

test('view composes the shared sub-header and hooks, not an inline header (AD-7, AD-6, FR-11)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'observability-view.tsx'), 'utf8');
  assert.match(src, /ObservabilitySubHeader/, 'renders the shared ObservabilitySubHeader');
  assert.match(src, /useTimeRangeWindow/, 'drives time/window state via the shared hook');
  assert.match(src, /useSpendRateChart/, 'builds chart data via the shared hook');
  assert.match(src, /useUrlViewState/, 'persists URL via the shared codec hook');
  assert.doesNotMatch(src, /timeBucketedRateByModel/, 'bucketing math no longer lives inline (AD-3 extracted)');
});

test('hero spend-rate chart renders above the summary cards (FR-1, DD-8)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'observability-view.tsx'), 'utf8');
  assert.ok(src.indexOf('<SpendRateChart') < src.indexOf('<SummaryCards'),
    'SpendRateChart must appear before SummaryCards in <main> (chart → cards → table)');
});
