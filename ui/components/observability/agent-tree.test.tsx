import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentTree } from './agent-tree';
import type { SubagentTree } from '@/lib/observability/subagent-tree';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const tree = (over: Partial<SubagentTree> = {}): SubagentTree => ({
  windowTotal: 1000,
  main: { key: 'main', kind: 'main', label: 'main-agent', tokens: 700, models: [{ model: 'opus', tokens: 700, dollars: 7 }], reqs: 10, firstMs: 0, lastMs: 100, newTokens: 100, dollars: 7 },
  subagents: [
    { key: 'a1', kind: 'run', label: 'coder', agentType: 'coder', tokens: 200, models: [{ model: 'sonnet', tokens: 200, dollars: 2 }], reqs: 3, firstMs: 0, lastMs: 100, newTokens: 30, dollars: 2 },
    { key: 'a2', kind: 'run', label: 'coder', agentType: 'coder', tokens: 100, models: [{ model: 'sonnet', tokens: 100, dollars: 1 }], reqs: 2, firstMs: 0, lastMs: 100, newTokens: 20, dollars: 1 },
  ],
  subagentTotal: 300, subagentPct: 0.3, ...over,
});

// Populated: title in header, main-agent row, the Subagents subtotal divider, card styling, NO tab role (FR-1, FR-5, DD-1).
{
  const html = renderToStaticMarkup(createElement(AgentTree, { tree: tree(), title: 'Agent Breakdown', ready: true, now: 100 }));
  assert.ok(html.includes('Agent Breakdown'), 'title prop renders in header (AD-1)');
  assert.ok(html.includes('main-agent'), 'main-agent row leads (FR-2)');
  assert.ok(html.includes('Subagents'), 'subagents subtotal divider present (FR-5)');
  assert.ok(html.includes('rounded-xl') && html.includes('bg-card') && html.includes('ring-foreground/10'), 'card matches summary-card styling (DD-1)');
  assert.ok(!/role="tab"|role="tablist"/.test(html), 'NO tabs anywhere — the tree IS the panel (DD-1)');
  console.log('✓ populated panel: header/title, main row, divider, card, no tabs');
}

// Light column header renders labels and shares AgentRow's exact grid template so columns align (Done when, DD-3).
{
  const html = renderToStaticMarkup(createElement(AgentTree, { tree: tree(), ready: true, now: 100 }));
  assert.ok(html.includes('Agent') && html.includes('Model spend'), 'header names the agent + bar columns');
  assert.ok(html.includes('Cost') && html.includes('New Tokens') && html.includes('Total Tokens'), 'header names the Cost / New Tokens / Total Tokens columns');
  const costIdx = html.indexOf('>Cost<');
  const totalTokensIdx = html.indexOf('Total Tokens');
  assert.ok(costIdx !== -1 && totalTokensIdx !== -1 && costIdx < totalTokensIdx, 'Cost column precedes Total Tokens, right after the bar');
  const gridTemplates = [...html.matchAll(/grid-cols-\[[^\]]*\]/g)].map((m) => m[0]);
  assert.ok(gridTemplates.length >= 2, 'both the header row and data rows carry a grid-cols template');
  assert.ok(gridTemplates.every((t) => t === gridTemplates[0]), 'header and row grid templates are identical (columns align)');
  console.log('✓ header row shares the row grid template');
}

// Pricing survives the flatten: Cost cells render non-empty on the main + each flat subagent row (invariant 2).
{
  const html = renderToStaticMarkup(createElement(AgentTree, { tree: tree(), ready: true, now: 100 }));
  assert.ok(html.includes('$7.00'), 'main row renders its Cost cell (formatUsd(dollars))');
  assert.ok(html.includes('$2.00') && html.includes('$1.00'), 'each flat subagent row renders its own Cost cell');
  console.log('✓ pricing cells render on the flat rows');
}

// Empty state when windowTotal === 0 (FR-10).
{
  const html = renderToStaticMarkup(createElement(AgentTree, { tree: tree({ windowTotal: 0, subagents: [], subagentTotal: 0, subagentPct: 0, main: { key: 'main', kind: 'main', label: 'main-agent', tokens: 0, models: [], reqs: 0, firstMs: 0, lastMs: 0, newTokens: 0, dollars: 0 } }), ready: true, now: 100 }));
  assert.ok(html.includes('No agent activity'), 'empty state copy shown (FR-10)');
  console.log('✓ empty state');
}

// Loading state when !ready → skeletons, no rows (FR-10).
{
  const html = renderToStaticMarkup(createElement(AgentTree, { tree: tree(), ready: false, now: 100 }));
  assert.ok(html.includes('aria-busy="true"'), 'loading panel marks aria-busy (FR-10, NFR-6)');
  assert.ok(!html.includes('main-agent'), 'no data rows while loading');
  console.log('✓ loading state');
}

// Coverage note shown when coverage < 0.99 (FR-10).
{
  const html = renderToStaticMarkup(createElement(AgentTree, { tree: tree(), ready: true, coverage: 0.6, now: 100 }));
  assert.ok(html.includes('60%') && html.toLowerCase().includes('covers'), 'partial-window note shown (FR-10)');
  console.log('✓ coverage note');
}

// NFR-8: fixture-session invariant — window total equals main + pooled subagent spend.
{
  const t = tree();
  assert.equal(t.windowTotal, t.main.tokens + t.subagentTotal, 'window total equals session spend (NFR-8)');
  assert.equal(t.windowTotal, 1000, 'fixture window total is 1000 (NFR-8)');
  console.log('✓ fixture-session invariant');
}

// Flat, ordered render: interleaved multi-type runs render one AgentRow per node in
// tree.subagents order, with no toggle/expand affordance anywhere (no group/leaf distinction left).
{
  const interleaved = tree({
    subagents: [
      { key: 'r1', kind: 'run', label: 'reviewer', agentType: 'reviewer', tokens: 100, models: [{ model: 'sonnet', tokens: 100, dollars: 1 }], reqs: 1, firstMs: 0, lastMs: 50, newTokens: 10, dollars: 1 },
      { key: 'c1', kind: 'run', label: 'coder', agentType: 'coder', tokens: 150, models: [{ model: 'sonnet', tokens: 150, dollars: 1.5 }], reqs: 2, firstMs: 50, lastMs: 100, newTokens: 15, dollars: 1.5 },
      { key: 'c2', kind: 'run', label: 'coder', agentType: 'coder', tokens: 50, models: [{ model: 'sonnet', tokens: 50, dollars: 0.5 }], reqs: 1, firstMs: 100, lastMs: 150, newTokens: 5, dollars: 0.5 },
    ],
    subagentTotal: 300, subagentPct: 0.3,
  });
  const html = renderToStaticMarkup(createElement(AgentTree, { tree: interleaved, ready: true, now: 200 }));
  const reviewerIdx = html.indexOf('reviewer');
  const firstCoderIdx = html.indexOf('coder');
  const secondCoderIdx = html.indexOf('coder', firstCoderIdx + 1);
  assert.ok(reviewerIdx !== -1 && firstCoderIdx !== -1 && secondCoderIdx !== -1, 'all three interleaved rows render');
  assert.ok(reviewerIdx < firstCoderIdx && firstCoderIdx < secondCoderIdx, 'rows render in tree.subagents order, not grouped by type');
  assert.ok(!/aria-expanded/.test(html), 'no aria-expanded anywhere — no toggle affordance (flat list)');
  assert.ok(!/lucide-chevron/i.test(html) && !html.includes('ChevronRight') && !html.includes('ChevronDown'), 'no chevron icon anywhere');
  console.log('✓ flat ordered render: interleaved multi-type runs, no toggle affordance');
}

console.log('\nAll AgentTree tests passed');
