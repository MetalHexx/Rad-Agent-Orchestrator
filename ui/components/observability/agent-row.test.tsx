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
  models: [{ model: 'opus', tokens: 100 }], reqs: 4, firstMs: 0, lastMs: 1000, ...p,
});

// Group variant: shows ×count badge + an aria-expanded caret button, and carries NO inspect button (FR-7, DD-5, NFR-6).
{
  const html = renderToStaticMarkup(createElement(AgentRow, { node: node({}), scaleMax: 200, variant: 'group', expanded: false }));
  assert.ok(html.includes('×3'), 'group shows ×3 count badge');
  assert.ok(html.includes('aria-expanded'), 'group caret exposes aria-expanded (NFR-6)');
  assert.ok(!html.includes('aria-label="Inspect agent"'), 'group rows carry no inspect button (FR-7)');
  console.log('✓ group row: badge + caret, no inspect button');
}

// Main variant: with inspect prop available=true renders the Inspect agent button (FR-3, NFR-6).
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ key: 'main', kind: 'main', label: 'main-agent', runCount: 1 }), scaleMax: 200, variant: 'main',
    inspect: { available: true, onInspect: () => {} },
  }));
  assert.ok(html.includes('main-agent'), 'label rendered');
  assert.ok(/aria-label="Inspect agent"/.test(html), 'main row with available inspect renders the Inspect agent button (FR-3, NFR-6)');
  assert.ok(!html.includes('TELEMETRY-8'), 'old disabled placeholder seam links are gone (FR-3)');
  assert.ok(html.includes('50%'), 'percent = tokens/scaleMax');
  console.log('✓ main row: inspect button + percent');
}

// Main variant without inspect prop: no inspect button rendered.
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ key: 'main', kind: 'main', label: 'main-agent', runCount: 1 }), scaleMax: 200, variant: 'main',
  }));
  assert.ok(!html.includes('aria-label="Inspect agent"'), 'main row without inspect prop renders no inspect button');
  console.log('✓ main row without inspect prop: no button');
}

// Run variant: monospace label, indented name cell (DD-3).
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ key: 'a1', kind: 'run', label: 'coder 1', runCount: 1 }), scaleMax: 200, variant: 'run',
  }));
  assert.ok(html.includes('font-mono'), 'run label is monospace (DD-3)');
  assert.ok(html.includes('pl-6'), 'run name cell is indented (DD-3)');
  console.log('✓ run row: mono + indent');
}

// Leaf/run variant: with inspect prop available=true renders the Inspect agent button (FR-4, NFR-6).
{
  const html = renderToStaticMarkup(createElement(AgentRow, {
    node: node({ key: 'run-bb', kind: 'run', label: 'Explore 1', runCount: 1 }), scaleMax: 200, variant: 'leaf',
    inspect: { available: true, onInspect: () => {} },
  }));
  assert.ok(/aria-label="Inspect agent"/.test(html), 'leaf row with available inspect renders the Inspect agent button (FR-4, NFR-6)');
  console.log('✓ leaf row: inspect button rendered when available');
}

// Legend states the three models once via house tokens (FR-12, DD-2, NFR-2).
{
  const html = renderToStaticMarkup(createElement(ModelLegend, {}));
  assert.ok(html.includes('opus') && html.includes('sonnet') && html.includes('haiku'), 'legend lists models');
  assert.ok(html.includes('var(--model-red)'), 'legend swatch uses model token (NFR-2)');
  console.log('✓ model legend');
}

console.log('\nAll AgentRow/ModelLegend tests passed');
