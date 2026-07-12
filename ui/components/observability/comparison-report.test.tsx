import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComparisonReport } from './comparison-report';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

function session(sessionId: string, costUsd: number | null, totalSpend: number, durationMs: number, toolErrors: number) {
  return {
    sessionId,
    title: sessionId,
    savedAt: '2026-06-25T00:00:00.000Z',
    snapshot: {
      worktree: null, model: 'claude-x', startedAt: '', durationMs, totalSpend,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      toolCalls: 0, toolErrors, subagents: 0, filesTouched: 0,
      costUsd, pricingVersion: 'v1', harness: 'harness-v1',
    },
  };
}

test('renders the Cost (USD) hero tile and table row from frozen snapshot.costUsd', () => {
  const baseline = session('base', 1.0, 100, 1000, 2);
  const candidate = session('cand', 2.0, 80, 800, 1);
  const html = renderToStaticMarkup(createElement(ComparisonReport, { baseline, candidate }));
  assert.ok(html.includes('Cost (USD)'), 'Cost (USD) label present (hero + table)');
  assert.ok(html.includes('$1.00'), 'baseline cost formatted');
  assert.ok(html.includes('$2.00'), 'candidate cost formatted');
});

test('hero is 3 tiles: Cost (USD), Total Spend (weighted), Duration — Tool Errors is not in the hero', () => {
  const baseline = session('base', 1.0, 100, 1000, 2);
  const candidate = session('cand', 2.0, 80, 800, 1);
  const html = renderToStaticMarkup(createElement(ComparisonReport, { baseline, candidate }));
  assert.ok(html.includes('Total Spend (weighted)'), 'relabeled Total Spend appears in hero and table');
  assert.ok(html.includes('Duration'), 'Duration hero tile present');
  assert.ok(html.includes('Tool Errors'), 'Tool Errors retained as a table row');
});

test('no harness row is present in the metrics table', () => {
  const baseline = session('base', 1.0, 100, 1000, 2);
  const candidate = session('cand', 2.0, 80, 800, 1);
  const html = renderToStaticMarkup(createElement(ComparisonReport, { baseline, candidate }));
  assert.ok(!html.includes('Harness'), 'no Harness row rendered');
});

test('a null-side Cost (USD) delta renders without a misleading percentage', () => {
  const baseline = session('base', null, 100, 1000, 2);
  const candidate = session('cand', 2.0, 80, 800, 1);
  const html = renderToStaticMarkup(createElement(ComparisonReport, { baseline, candidate }));
  assert.ok(html.includes('price unavailable'), 'baseline cost renders as unavailable, not $0');
});
