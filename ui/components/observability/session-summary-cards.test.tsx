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
    sessionId: 's', usageId: 'u', timestamp: '2026-06-21T00:00:00.000Z', model: 'm',
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    source: 'main-agent', ...partial,
  };
}

const session: SessionAgg = {
  sessionId: 's', startedMs: 0, lastMs: 12 * 60_000 + 30_000, spend: 4_820_000,
  rows: [
    row({ source: 'main-agent' }),
    row({ source: 'subagent', agentId: 'a1' }),
    row({ source: 'subagent', agentId: 'a2' }),
  ],
};

test('renders three cards in order: Total Spend (weighted), Subagents, Duration (FR-1, DD-1)', () => {
  const html = renderToStaticMarkup(createElement(SessionSummaryCards, { session }));
  const ts = html.indexOf('Total Spend (weighted)'), su = html.indexOf('Subagents'), du = html.indexOf('Duration');
  assert.ok(ts !== -1 && su !== -1 && du !== -1, 'all three labels present');
  assert.ok(ts < su && su < du, 'ordered Total Spend (weighted) → Subagents → Duration');
});

test('shows shared spend, subagent count, and humanized duration; no dollars (FR-1, FR-4, NFR-4)', () => {
  const html = renderToStaticMarkup(createElement(SessionSummaryCards, { session }));
  assert.ok(html.includes('4.82M'), 'total spend humanized via the shared card');
  assert.ok(html.includes('2'), 'subagent count is 2');
  assert.ok(html.includes('12m'), 'duration humanized via formatDuration (750000ms → 12m)');
  assert.ok(!html.includes('$'), 'no dollar cost');
});
