import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { DagStateCard } from './dag-state-card';
import type { ProjectStateV5, GraphStatus, NodesRecord } from '@/types/state';
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

// A minimal phase-loop → task-loop → task_executor tree, deep enough that the
// engine's real bracket-index `current_node_path` grammar has somewhere to
// resolve to.
const BRACKET_NODES: NodesRecord = {
  phase_loop: {
    kind: 'for_each_phase',
    status: 'in_progress',
    iterations: [
      {
        index: 0,
        status: 'in_progress',
        doc_path: 'phases/DEMO-PHASE-01-SETUP.md',
        corrective_tasks: [],
        repos: [],
        nodes: {
          task_loop: {
            kind: 'for_each_task',
            status: 'in_progress',
            iterations: [
              {
                index: 0,
                status: 'in_progress',
                doc_path: 'tasks/DEMO-TASK-P01-T01-AUTH.md',
                repos: [],
                corrective_tasks: [],
                nodes: {
                  task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                },
              },
            ],
          },
        },
      },
    ],
  },
};

function makeBracketState(currentNodePath: string): ProjectStateV5 {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'std', status: 'in_progress', current_node_path: currentNodePath, nodes: BRACKET_NODES },
  };
}

test('a bracket-format current_node_path on task_executor renders the Coding view, not the fallback', () => {
  const html = renderToStaticMarkup(
    createElement(DagStateCard, {
      ...baseProps,
      state: makeBracketState('phase_loop[0].task_loop[0].task_executor'),
    }),
  );
  assert.ok(html.includes('Task Handoff'), 'Coding view control renders');
  assert.ok(!html.includes('Pipeline node'), 'fallback view did not render');
});

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

test('a state change crossfades: the outgoing state fades OUT while the incoming fades IN — both mounted at once', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const win = dom.window as unknown as Window & typeof globalThis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (win as any).matchMedia = (query: string) => ({
    matches: false, // motion allowed → crossfade runs
    media: query,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = win;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = win.document;
  // base-ui's useButton checks the global HTMLElement when the coding view's buttons mount.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = win.HTMLElement;

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const container = win.document.getElementById('root')!;
  const root = createRoot(container);

  // Mount in the fallback state.
  await act(async () => {
    root.render(createElement(DagStateCard, { ...baseProps, state: makeState('some_unmapped_node') }));
  });
  assert.ok(container.querySelector('.animate-in'), 'incoming content mounts with a fade-in');
  assert.ok(!container.querySelector('.animate-out'), 'nothing is fading out on the very first mount');

  // Switch to the coding state on the SAME mounted card — this is the real crossfade trigger.
  await act(async () => {
    root.render(createElement(DagStateCard, { ...baseProps, state: makeBracketState('phase_loop[0].task_loop[0].task_executor') }));
  });

  assert.ok(container.querySelector('.animate-in'), 'the incoming (coding) state fades in');
  assert.ok(container.querySelector('.animate-out'), 'the outgoing (fallback) state stays mounted and fades out');
  // Both contents are genuinely present in the DOM during the crossfade:
  assert.ok(container.textContent!.includes('Task Handoff'), 'incoming coding content is present');
  assert.ok(container.textContent!.includes('Pipeline node'), 'outgoing fallback content is still present mid-crossfade');

  await act(async () => { root.unmount(); });
});
