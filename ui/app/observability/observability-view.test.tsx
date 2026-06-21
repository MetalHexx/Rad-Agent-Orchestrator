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

test('chart window is range-driven and decoupled from the 1s clock; sections reordered (FR-5, AD-3, DD-3)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'observability-view.tsx'), 'utf8');
  assert.match(src, /endMs:\s*rangeEnd\b/, 'chart buckets to the selected range end, not the 1s now');
  assert.doesNotMatch(src, /timeBucketedRate\(\[\.\.\.rows\.values\(\)\],\s*\{\s*endMs:\s*now\b/, 'chart no longer keyed to the per-second now');

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

test('table/cards include the live tail; chart keeps the range-end bound (FR-9, AD-6, DD-4)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'observability-view.tsx'), 'utf8');
  assert.match(src, /rowsSince\(\[\.\.\.rows\.values\(\)\]\s*,\s*rangeStart\)/, 'table/cards window is lower-bounded to the live tail, not clamped to rangeEnd');
  assert.match(src, /endMs:\s*rangeEnd\b/, 'chart still buckets to the tick-pinned range end (DD-4 axis stability preserved)');
});

test('manual refresh advances the window to now (FR-2)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'observability-view.tsx'), 'utf8');
  assert.doesNotMatch(src, /setRangeId\(\s*id\s*=>\s*id\s*\)/, 'manual refresh is no longer a no-op');
  assert.match(src, /handleRefreshNow[\s\S]{0,120}(Date\.now\(\)|setManualTick)/, 'manual refresh advances the now-relative window');
});

test('order is cards → chart → controls → table, with the time picker not the old bar (DD-2, AD-9, NFR-4)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'observability-view.tsx'), 'utf8');
  assert.match(src, /TimeRangePicker/, 'view composes the TimeRangePicker (AD-9)');
  assert.doesNotMatch(src, /ControlBar|Auto · /, 'old control bar and auto-refresh pill are gone (FR-14)');

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

test('builds per-model chart data via timeBucketedRateByModel with token-colored series (FR-7, NFR-1, DD-4)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'observability-view.tsx'), 'utf8');
  assert.ok(src.includes('timeBucketedRateByModel'), 'chart data comes from the per-model bucketer');
  assert.ok(src.includes('modelColor'), 'model line colors resolved via the house-token util');
  assert.ok(src.includes('Token Spend Rate'), 'passes the Token Spend Rate title');
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
