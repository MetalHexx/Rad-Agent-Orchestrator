import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentRow } from './agent-row';
import { ModelLegend } from './model-legend';
import type { AgentTreeNode } from '@/lib/observability/subagent-tree';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const node = (p: Partial<AgentTreeNode>): AgentTreeNode => ({
  key: 'coder', kind: 'group', label: 'coder', runCount: 3, tokens: 100,
  models: [{ model: 'opus', tokens: 100, dollars: 1.23 }], reqs: 4, firstMs: 0, lastMs: 1000,
  newTokens: 20, dollars: 1.23, ...p,
});

// Group variant: shows ×count badge + an aria-expanded caret button, and carries NO inspect overlay (FR-7, DD-5, NFR-6).
{
  const html = renderToStaticMarkup(createElement(AgentRow, { node: node({}), scaleMax: 200, variant: 'group', expanded: false, now: 1000 }));
  assert.ok(html.includes('×3'), 'group shows ×3 count badge');
  assert.ok(html.includes('aria-expanded'), 'group caret exposes aria-expanded (NFR-6)');
  assert.ok(!/aria-label="Inspect /.test(html), 'group rows carry no inspect overlay (FR-7)');
  console.log('✓ group row: badge + caret, no inspect overlay');
}

// Main variant: with inspect prop renders a whole-row clickable overlay (FR-3, NFR-6).
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ key: 'main', kind: 'main', label: 'main-agent', runCount: 1 }), scaleMax: 200, variant: 'main', now: 1000,
    inspect: { onInspect: () => {} },
  }));
  assert.ok(html.includes('main-agent'), 'label rendered');
  assert.ok(/aria-label="Inspect /.test(html), 'main row with inspect renders the whole-row inspect overlay (FR-3, NFR-6)');
  assert.ok(html.includes('cursor-pointer'), 'clickable row shows the hand cursor');
  assert.ok(!html.includes('TELEMETRY-8'), 'old disabled placeholder seam links are gone (FR-3)');
  console.log('✓ main row: whole-row inspect overlay');
}

// Main variant without inspect prop: row is not clickable, no overlay rendered.
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ key: 'main', kind: 'main', label: 'main-agent', runCount: 1 }), scaleMax: 200, variant: 'main', now: 1000,
  }));
  assert.ok(!/aria-label="Inspect /.test(html), 'main row without inspect prop renders no inspect overlay');
  console.log('✓ main row without inspect prop: no overlay');
}

// Run variant: monospace label, indented name cell (DD-3).
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ key: 'a1', kind: 'run', label: 'coder 1', runCount: 1 }), scaleMax: 200, variant: 'run', now: 1000,
  }));
  assert.ok(html.includes('font-mono'), 'run label is monospace (DD-3)');
  assert.ok(html.includes('pl-6'), 'run name cell is indented (DD-3)');
  console.log('✓ run row: mono + indent');
}

// Leaf/run variant: with inspect prop renders the whole-row inspect overlay (FR-4, NFR-6).
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ key: 'run-bb', kind: 'run', label: 'Explore 1', runCount: 1 }), scaleMax: 200, variant: 'leaf', now: 1000,
    inspect: { onInspect: () => {} },
  }));
  assert.ok(/aria-label="Inspect /.test(html), 'leaf row with inspect renders the whole-row inspect overlay (FR-4, NFR-6)');
  console.log('✓ leaf row: inspect overlay rendered when inspectable');
}

// Legend states the three models once via house tokens (FR-12, DD-2, NFR-2).
{
  const html = renderToStaticMarkup(createElement(ModelLegend, {}));
  assert.ok(html.includes('opus') && html.includes('sonnet') && html.includes('haiku'), 'legend lists models');
  assert.ok(html.includes('var(--model-red)'), 'legend swatch uses model token (NFR-2)');
  console.log('✓ model legend');
}

// Active agent dot pulses in the model color via ActivityDot (FR-2, DD-1, AD-3).
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ kind: 'main', label: 'main-agent', models: [{ model: 'opus', tokens: 100, dollars: 1.23 }], lastMs: 1000 }),
    scaleMax: 200, variant: 'main', now: 1000,
  }));
  assert.ok(html.includes('activity-dot-pulse'), 'fresh agent dot pulses (FR-2)');
  assert.ok(html.includes('var(--model-red)'), 'dot uses the opus model color (DD-1)');
  assert.ok(html.includes('--activity-dot-glow-color'), 'glow color threaded to the dot (DD-2)');
  console.log('✓ agent dot: model-colored pulse');
}

// A subagent idle for ~2 min settles (no pulse) — Agent Breakdown uses the short 60s window so a
// finished subagent no longer reads as "live" while the next one runs (the sequential-looks-parallel bug).
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ kind: 'main', label: 'main-agent', models: [{ model: 'opus', tokens: 100, dollars: 1.23 }], lastMs: 0 }),
    scaleMax: 200, variant: 'main', now: 120_000,
  }));
  assert.ok(!html.includes('activity-dot-pulse'), 'agent dot idle for 2 min does not pulse (settles within 60s)');
  assert.ok(html.includes('var(--model-red)'), 'settled dot still rests in its opus model color (not grey)');
  console.log('✓ agent dot: settles after 60s, rests at model color');
}

// Cost / New Tokens / Total Tokens cells render honest labeled values, not a bare humanized token count (Done when).
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ newTokens: 12_000, tokens: 100_000, dollars: 4.5 }), scaleMax: 200_000, variant: 'main', now: 1000,
  }));
  assert.ok(html.includes('12.0K'), 'New Tokens cell shows humanized newTokens (Σ cacheCreationTokens)');
  assert.ok(html.includes('100.0K'), 'Total Tokens cell shows humanized effective tokens (cost-weighted)');
  assert.ok(html.includes('$4.50'), 'Cost cell shows the formatted dollar figure');
  console.log('✓ row: Cost / New Tokens / Total Tokens cells render');
}

// A node with an unknown-priced model renders "price unavailable" for its dollar cell, never $0 (Done when).
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ dollars: null }), scaleMax: 200, variant: 'main', now: 1000,
  }));
  assert.ok(html.includes('price unavailable'), 'unpriced node renders "price unavailable"');
  assert.ok(!html.includes('$0.00'), 'never silently renders $0 for an unpriced node');
  console.log('✓ row: unpriced node renders unavailable, not $0');
}

console.log('\nAll AgentRow/ModelLegend tests passed');
