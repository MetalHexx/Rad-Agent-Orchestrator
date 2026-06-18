import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionTable } from './session-table';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

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
