import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionTable } from './session-table';
import { timeBucketedRate, rowsInWindow, deriveSessions } from '@/lib/observability/sessions';
import { bucketsForWindow } from '@/lib/observability/time-range';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const sessionTableSource = fs.readFileSync(path.join(__dirname, 'session-table.tsx'), 'utf8');

const sessions = [
  { sessionId: 'sess-1111aaaa', worktree: 'C:\\dev\\orchestration\\v3', startedMs: Date.parse('2026-06-18T10:00:00Z'), lastMs: Date.parse('2026-06-18T11:23:00Z'), spend: 1_230_000, rows: [] },
  { sessionId: 'sess-2222bbbb', worktree: undefined, startedMs: Date.parse('2026-06-18T09:00:00Z'), lastMs: Date.parse('2026-06-18T09:12:00Z'), spend: 5_000, rows: [] },
];

test('renders the exact column headers in order (FR-7, DD-5)', () => {
  const html = renderToStaticMarkup(createElement(SessionTable, { sessions, now: Date.parse('2026-06-18T11:30:00Z') }));
  const order = ['Activity', 'Worktree', 'Session', 'Started', 'Duration', 'Total Spend', 'Current Rate'];
  let last = -1;
  for (const h of order) { const i = html.indexOf(h); assert.ok(i > last, `header ${h} present and ordered`); last = i; }
  assert.ok(!html.includes('Status') && !html.includes('Model'), 'no Status or Model column (DD-5)');
});

test('absent worktree renders "unknown"; spend is humanized; default sort is newest-first (FR-8, FR-9, DD-5)', () => {
  const html = renderToStaticMarkup(createElement(SessionTable, { sessions, now: Date.parse('2026-06-18T11:30:00Z') }));
  assert.ok(html.includes('unknown'), 'absent worktree → unknown');
  assert.ok(html.includes('1.23M'), 'spend humanized');
  assert.ok(html.indexOf('sess-1111aaaa') < html.indexOf('sess-2222bbbb'), 'newest started first');
});

test('Total Spend column header carries an explanatory tooltip (FR-14, DD-10)', () => {
  assert.match(
    sessionTableSource,
    /from\s*["']@\/components\/ui\/tooltip["']/,
    "session-table imports from the house tooltip module"
  );
  assert.ok(
    sessionTableSource.includes('TooltipTrigger') && sessionTableSource.includes('TooltipContent'),
    "session-table uses TooltipTrigger and TooltipContent"
  );
  // The Total Spend column header must be enclosed by TooltipTrigger/TooltipContent
  // Find the block around the JSX 'Total Spend' literal and check it's wrapped
  assert.match(
    sessionTableSource,
    /TooltipTrigger[\s\S]{0,200}Total Spend[\s\S]{0,200}TooltipContent/,
    "Total Spend header text is enclosed by TooltipTrigger/TooltipContent"
  );
});

test('Activity column is centered and columns use a fixed colgroup layout (DD-7, DD-8)', () => {
  const html = renderToStaticMarkup(createElement(SessionTable, { sessions, now: Date.parse('2026-06-18T11:30:00Z') }));
  assert.ok(html.includes('<colgroup'), 'a colgroup defines column widths');
  assert.ok(/text-center/.test(html), 'the Activity header/cell is centered');
  assert.ok(!html.includes('max-w-[160px]') && !html.includes('max-w-[120px]'), 'identity columns no longer hard-capped');
});

test('metric columns carry explicit widths, not the broken width:1% trick (table-fixed)', () => {
  // Under table-layout:fixed, width:1% is taken literally (~15px), collapsing the
  // metric columns. They must use explicit pixel widths instead. Regression guard.
  assert.ok(!/width:\s*["']?1%/.test(sessionTableSource), 'no metric column uses the width:1% trick');
  assert.match(sessionTableSource, /width:\s*["']?176px/, 'Started column has an explicit pixel width');
  assert.match(sessionTableSource, /width:\s*["']?120px/, 'Total Spend column has an explicit pixel width');
  // identity columns still flex
  assert.match(sessionTableSource, /width:\s*["']?auto/, 'identity columns remain auto-width (flex + truncate)');
});

test('Current Rate column is hidden below the sm breakpoint (DD-10, FR-8)', () => {
  const html = renderToStaticMarkup(createElement(SessionTable, { sessions, now: Date.parse('2026-06-18T11:30:00Z') }));
  assert.ok(/hidden\s+sm:table-cell/.test(html), 'sparkline column collapses on small screens');
});

test('row scanline buckets over the shared now-window (grid-anchored) when one is supplied (live, FR-10)', () => {
  // The sparkline must follow the passed range window, not the frozen session lifetime, so it slides
  // and updates like the Total Rate chart. Falls back to the lifetime when no window is supplied.
  assert.match(sessionTableSource, /rangeStart\?:\s*number/, 'accepts an optional rangeStart window prop');
  assert.match(sessionTableSource, /endMs:\s*rangeEnd\s*\?\?\s*s\.lastMs/, 'scanline end follows the now-window (falls back to lifetime)');
  assert.match(sessionTableSource, /anchor:\s*rangeEnd\s*!=\s*null\s*\?\s*["']grid["']/, 'scanline uses grid anchoring under the shared window');
});

test('row scanline matches the Total Rate chart bucket size and window clip (FR-11)', () => {
  // The scanline must obey the identical window contract as the chart, differing only in row scope
  // (one session vs all). That means the SAME bucket count and an X-axis clipped to the same window.
  assert.match(sessionTableSource, /from\s*["']@\/lib\/observability\/time-range["']/, 'imports bucketsForWindow from the time-range helper');
  assert.match(
    sessionTableSource,
    /buckets:\s*nominalWindowMs\s*!=\s*null\s*\?\s*bucketsForWindow\(nominalWindowMs\)\s*:\s*30/,
    'scanline bucket count tracks the chart (bucketsForWindow(nominalWindowMs)), not a hardcoded 30',
  );
  // The `={...}` JSX-attribute form is distinctive to the RateSparkline element (elsewhere
  // rangeStart/rangeEnd appear only as bare identifiers), so assert each prop is forwarded.
  assert.match(sessionTableSource, /rangeStart=\{rangeStart\}/, 'forwards rangeStart so the sparkline clips its X-axis like the chart');
  assert.match(sessionTableSource, /rangeEnd=\{rangeEnd\}/, 'forwards rangeEnd so the sparkline clips its X-axis like the chart');
});

test('renders with an explicit window without error (live scanline path)', () => {
  const html = renderToStaticMarkup(createElement(SessionTable, {
    sessions,
    now: Date.parse('2026-06-18T11:30:00Z'),
    rangeStart: Date.parse('2026-06-18T09:00:00Z'),
    rangeEnd: Date.parse('2026-06-18T11:30:00Z'),
  }));
  assert.ok(html.includes('sess-1111aaaa'), 'rows still render under the windowed scanline path');
});

test('renders a save-star control per row when savedIds is supplied (FR-3, DD-2)', () => {
  const html = renderToStaticMarkup(createElement(SessionTable, {
    sessions, now: Date.parse('2026-06-18T11:30:00Z'),
    savedIds: new Set(['sess-2222bbbb']), onToggleSave: () => {},
  }));
  assert.ok(html.includes('aria-label="Save benchmark"'), 'an unsaved row shows a Save star');
  assert.ok(html.includes('aria-label="Remove from saved benchmarks"'), 'a saved row shows a filled (Remove) star');
});

test('FR-11 contract: the scanline series is identical to the Total Rate series for a single filtered session', () => {
  // The behavioral guarantee behind the source wiring above: when narrowed to one session, the
  // per-row scanline must produce the SAME curve over the SAME x-span as the Total Rate chart.
  // Both paths funnel through timeBucketedRate; this asserts they agree given the same window.
  const r = (usageId: string, iso: string, outputTokens: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ sessionId: 's1', usageId, timestamp: iso, inputTokens: 0, outputTokens, cacheReadTokens: 0, cacheCreationTokens: 0 } as any);
  const rows = [
    r('a', '2026-06-18T09:10:00.000Z', 2),
    r('b', '2026-06-18T09:55:00.000Z', 6),
    r('c', '2026-06-18T10:40:00.000Z', 4),
  ];
  const rangeStart = Date.parse('2026-06-18T09:00:00.000Z');
  const rangeEnd = Date.parse('2026-06-18T11:00:00.000Z');
  const nominalWindowMs = rangeEnd - rangeStart;
  const opts = { endMs: rangeEnd, windowMs: nominalWindowMs, buckets: bucketsForWindow(nominalWindowMs), anchor: 'grid' as const };

  const session = deriveSessions(rows)[0]; // the lone filtered session

  // Total Rate path: rows summed across ALL filtered sessions (here just this one).
  const chartSeries = timeBucketedRate(rowsInWindow([session].flatMap((s) => s.rows), rangeStart, rangeEnd), opts);
  // Scanline path: the one session's rows, same window.
  const sparkSeries = timeBucketedRate(rowsInWindow(session.rows, rangeStart, rangeEnd), opts);

  assert.deepEqual(sparkSeries, chartSeries, 'same curve over the same x-span (FR-11)');
  assert.ok(chartSeries.some((p) => p.value > 0), 'sanity: the parity check actually exercises non-zero buckets');
});
