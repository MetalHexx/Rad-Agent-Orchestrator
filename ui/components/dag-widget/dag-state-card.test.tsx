import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { DagStateCard } from './dag-state-card';
import type { ProjectStateV5, GraphStatus } from '@/types/state';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeState(currentNodePath: string | null, status: GraphStatus = 'in_progress'): ProjectStateV5 {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'std', status, current_node_path: currentNodePath, nodes: {} },
  };
}

const baseProps = { onDocClick: () => {}, compareUrlByRepo: {}, projectName: 'demo' };

test('renders the fallback view for an unknown current node without crashing', () => {
  const html = renderToStaticMarkup(
    createElement(DagStateCard, { ...baseProps, state: makeState('some_unmapped_node') }),
  );
  assert.ok(html.includes('Some Unmapped Node'), 'neutral title derived from the node id');
  assert.match(html, /<svg/, 'the node kind icon is rendered');
});

test('renders without crashing for a completed graph', () => {
  const html = renderToStaticMarkup(
    createElement(DagStateCard, { ...baseProps, state: makeState(null, 'completed') }),
  );
  // The registered complete view renders — the shell must still resolve and
  // paint safely even with an otherwise-empty node tree.
  assert.ok(html.length > 0);
});

test('the crossfade region carries the fade animation when motion is allowed', () => {
  const html = renderToStaticMarkup(
    createElement(DagStateCard, { ...baseProps, state: makeState('some_unmapped_node') }),
  );
  assert.match(html, /animate-in fade-in-0/, 'inner content dissolves in on state change');
});

// A jsdom client render exercises the reduced-motion effect: with the preference
// set, the crossfade is suppressed so the content swap is instant.
async function clientRenderClassName(prefersReduced: boolean): Promise<string> {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const win = dom.window as unknown as Window & typeof globalThis;
  // jsdom ships no matchMedia — stub it so the reduced-motion effect can read it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (win as any).matchMedia = (query: string) => ({
    matches: prefersReduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = win;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = win.document;

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const container = win.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(DagStateCard, { ...baseProps, state: makeState('some_unmapped_node') }));
  });
  const grid = container.querySelector('[style*="grid-template"]') as HTMLElement;
  const className = grid.className;
  await act(async () => { root.unmount(); });
  return className;
}

test('prefers-reduced-motion suppresses the crossfade (instant swap)', async () => {
  const reduced = await clientRenderClassName(true);
  assert.ok(!reduced.includes('animate-in'), 'no fade animation under reduced motion');
});

test('motion allowed keeps the crossfade animation on the mounted content', async () => {
  const allowed = await clientRenderClassName(false);
  assert.ok(allowed.includes('animate-in'), 'fade animation present when motion is allowed');
});
