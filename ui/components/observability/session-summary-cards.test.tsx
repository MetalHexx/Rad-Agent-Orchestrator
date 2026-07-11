import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionSummaryCards } from './session-summary-cards';
import type { SessionAgg } from '@/lib/observability/sessions';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function row(partial: any) {
  return {
    sessionId: 's', usageId: 'u', timestamp: '2026-06-21T00:00:00.000Z', model: 'claude-opus-4-8',
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    source: 'main-agent', ...partial,
  };
}

const session: SessionAgg = {
  sessionId: 's', startedMs: 0, lastMs: 12 * 60_000 + 30_000, spend: 4_820_000,
  rows: [
    row({ source: 'main-agent', inputTokens: 1000 }),
    row({ source: 'subagent', agentId: 'a1' }),
    row({ source: 'subagent', agentId: 'a2' }),
  ],
};

test('renders four cards in order: Cost (USD), Token Spend, Subagents, Duration (FR-1, DD-1)', () => {
  const html = renderToStaticMarkup(createElement(SessionSummaryCards, { session }));
  const cu = html.indexOf('Cost (USD)'), ts = html.indexOf('Token Spend'), su = html.indexOf('Subagents'), du = html.indexOf('Duration');
  assert.ok(cu !== -1 && ts !== -1 && su !== -1 && du !== -1, 'all four labels present');
  assert.ok(cu < ts && ts < su && su < du, 'ordered Cost (USD) → Token Spend → Subagents → Duration');
});

test('shows this session\'s dollar cost, shared spend, subagent count, and humanized duration (FR-1, FR-4, NFR-4)', () => {
  const html = renderToStaticMarkup(createElement(SessionSummaryCards, { session }));
  assert.ok(html.includes('$'), 'Cost (USD) card shows a priced dollar figure');
  assert.ok(html.includes('4.82M'), 'total spend humanized via the shared card');
  assert.ok(html.includes('2'), 'subagent count is 2');
  assert.ok(html.includes('12m'), 'duration humanized via formatDuration (750000ms → 12m)');
});

test('an unpriced model renders "price unavailable" for the Cost (USD) card, never $0 (DD-2)', () => {
  const unpriced: SessionAgg = { ...session, rows: session.rows.map((r) => ({ ...r, model: 'unknown-model' })) };
  const html = renderToStaticMarkup(createElement(SessionSummaryCards, { session: unpriced }));
  assert.ok(html.includes('price unavailable'), 'unpriced model renders unavailable, not $0');
  assert.ok(!html.includes('$0.00'), 'never a silent $0');
});
