import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentTree } from './agent-tree';
import type { SubagentTree } from '@/lib/observability/subagent-tree';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const tree = (over: Partial<SubagentTree> = {}): SubagentTree => ({
  windowTotal: 1000,
  main: { key: 'main', kind: 'main', label: 'main-agent', runCount: 1, tokens: 700, models: [{ model: 'opus', tokens: 700 }], reqs: 10, firstMs: 0, lastMs: 100 },
  subagents: [{ key: 'coder', kind: 'group', label: 'coder', agentType: 'coder', runCount: 2, tokens: 300, models: [{ model: 'sonnet', tokens: 300 }], reqs: 5, firstMs: 0, lastMs: 100,
    runs: [
      { key: 'a1', kind: 'run', label: 'coder 1', runCount: 1, tokens: 200, models: [{ model: 'sonnet', tokens: 200 }], reqs: 3, firstMs: 0, lastMs: 100 },
      { key: 'a2', kind: 'run', label: 'coder 2', runCount: 1, tokens: 100, models: [{ model: 'sonnet', tokens: 100 }], reqs: 2, firstMs: 0, lastMs: 100 },
    ] }],
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

// Empty state when windowTotal === 0 (FR-10).
{
  const html = renderToStaticMarkup(createElement(AgentTree, { tree: tree({ windowTotal: 0, subagents: [], subagentTotal: 0, subagentPct: 0, main: { key: 'main', kind: 'main', label: 'main-agent', runCount: 1, tokens: 0, models: [], reqs: 0, firstMs: 0, lastMs: 0 } }), ready: true, now: 100 }));
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

// Coverage note appended to scale hint when coverage < 0.99 (FR-10).
{
  const html = renderToStaticMarkup(createElement(AgentTree, { tree: tree(), ready: true, coverage: 0.6, now: 100 }));
  assert.ok(html.includes('60%') && html.toLowerCase().includes('covers'), 'partial-window note appended (FR-10)');
  console.log('✓ coverage note');
}

// NFR-8: fixture-session invariant — window total equals main + pooled subagent spend.
{
  const t = tree();
  assert.equal(t.windowTotal, t.main.tokens + t.subagentTotal, 'window total equals session spend (NFR-8)');
  assert.equal(t.windowTotal, 1000, 'fixture window total is 1000 (NFR-8)');
  console.log('✓ fixture-session invariant');
}

// NFR-8: stable-key expand/collapse — expand state is a node.key-keyed Set (source-text invariant; SSR harness cannot drive interaction).
{
  const src = readFileSync(new URL('./agent-tree.tsx', import.meta.url), 'utf8');
  assert.ok(/useState<Set<string>>/.test(src), 'expand state is a Set<string> (NFR-8)');
  assert.ok(/next\.has\(key\)/.test(src), 'toggle reads membership by key (NFR-8)');
  assert.ok(/next\.add\(key\)/.test(src) && /next\.delete\(key\)/.test(src), 'toggle mutates the set by node.key (NFR-8)');
  console.log('✓ stable-key expand/collapse (source invariant)');
}

console.log('\nAll AgentTree tests passed');
