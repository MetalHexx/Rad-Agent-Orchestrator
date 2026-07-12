import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SavedRow } from './saved-row';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const session = { sessionId: 's1', title: 's1', savedAt: '2026-06-25T00:00:00.000Z',
  snapshot: { worktree: null, model: null, startedAt: '', durationMs: 0, totalSpend: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, toolCalls: 0, toolErrors: 0, subagents: 0, filesTouched: 0,
    costUsd: 0.42, pricingVersion: 'v1', harness: 'harness-v1' } };

test('renders the rename (pencil) control on the row (FR-5, DD-4)', () => {
  const html = renderToStaticMarkup(createElement(SavedRow, { session }));
  assert.ok(html.includes('aria-label="Rename benchmark"'), 'pencil rename control present in display mode');
});

test('renders the BASELINE badge inline (left of the title) only when isBaseline (DD-7)', () => {
  const plain = renderToStaticMarkup(createElement(SavedRow, { session }));
  assert.ok(!plain.includes('BASELINE'), 'no badge when the row is not the baseline');
  const baseline = renderToStaticMarkup(createElement(SavedRow, { session, isBaseline: true }));
  assert.ok(baseline.includes('BASELINE'), 'badge renders when isBaseline is set');
});

test('renders the Cost cell from frozen snapshot.costUsd formatted as USD', () => {
  const html = renderToStaticMarkup(createElement(SavedRow, { session }));
  assert.ok(html.includes('$0.42'), 'Cost cell displays formatted dollar amount');
});

test('renders "price unavailable" when costUsd is null', () => {
  const nullCostSession = {
    ...session,
    snapshot: { ...session.snapshot, costUsd: null }
  };
  const html = renderToStaticMarkup(createElement(SavedRow, { session: nullCostSession }));
  assert.ok(html.includes('price unavailable'), 'Cost cell displays unavailable message for null costUsd');
});

test('renders jump-to-session link with correct href', () => {
  const html = renderToStaticMarkup(createElement(SavedRow, { session }));
  assert.ok(html.includes('href="/observability/session/s1"'), 'jump-to-session link targets correct session detail URL');
});
