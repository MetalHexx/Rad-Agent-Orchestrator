import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { WorkGraphProjectNode } from './work-graph-project-node';
import type { WorkGraphProjectData } from '@/types/work-graph';
import type { ProjectState } from '@/types/components';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// A real value reference so esbuild's unused-import elision can't drop this import —
// its side effect of populating require.cache (this module, transitively
// next/navigation) is exactly what loadMockedNode below depends on.
assert.strictEqual(WorkGraphProjectNode.name, 'WorkGraphProjectNode');

/**
 * WorkGraphProjectNode calls useRouter() unconditionally, which throws outside a
 * mounted Next app router. tsx compiles imports to CJS require(), so require.cache
 * is accessible — the same require-cache-swap technique app-header.test.tsx uses
 * for usePathname.
 */
let pushCalls: string[] = [];

function loadMockedNode(): typeof WorkGraphProjectNode {
  const req = require as NodeRequire & { cache: Record<string, { exports: unknown } | undefined> };
  const navPath = req.resolve('next/navigation');
  const nodePath = req.resolve('./work-graph-project-node');
  const origNavExports = req.cache[navPath]?.exports;
  assert.ok(origNavExports, 'next/navigation must be in require cache before mock');

  const mock = Object.create(origNavExports as object) as Record<string, unknown>;
  Object.defineProperty(mock, 'useRouter', {
    value: () => ({ push: (path: string) => { pushCalls.push(path); } }),
    writable: true,
    enumerable: true,
    configurable: true,
  });

  req.cache[navPath]!.exports = mock;
  delete req.cache[nodePath];
  try {
    const fresh = req('./work-graph-project-node') as { WorkGraphProjectNode: typeof WorkGraphProjectNode };
    return fresh.WorkGraphProjectNode;
  } finally {
    req.cache[navPath]!.exports = origNavExports;
  }
}

let MockedNode: typeof WorkGraphProjectNode;
before(() => {
  MockedNode = loadMockedNode();
});
beforeEach(() => {
  pushCalls = [];
});

function render(
  tier: WorkGraphProjectData['tier'],
  state: ProjectState,
  stateLabel: string,
  projectType: WorkGraphProjectData['projectType'] = 'standard',
): string {
  const data: WorkGraphProjectData = { id: 'proj-1', label: 'Project One', tier, state, stateLabel, projectType };
  return renderToStaticMarkup(
    createElement(ReactFlowProvider, null, createElement(MockedNode, { data })),
  );
}

test('the badge renders the caller-supplied stateLabel verbatim, not a word derived from tier', () => {
  // A deliberately mismatched tier/state pair proves the label is data the
  // node passes through, never recomputed from `tier`.
  const html = render('execution', 'complete', 'Custom Label For Test');
  assert.ok(html.includes('Custom Label For Test'), 'renders the exact stateLabel handed to it');
  assert.ok(!html.includes('Pending Review'), 'must not reconstruct a tier-derived word instead');
});

for (const tier of ['planning', 'execution', 'review', 'halted', 'complete', 'not_initialized'] as const) {
  test(`accent for tier "${tier}" is keyed off data.tier, independent of data.state`, () => {
    // state/stateLabel are held constant (an unrelated value) to prove the accent
    // reads off `tier` alone — this is the accepted cosmetic seam: accent and
    // badge are keyed off two different fields.
    const html = render(tier, 'halted', 'Halted');
    assert.ok(html.includes(`inset 3px 0 0 var(--tier-${tier === 'not_initialized' ? 'not-initialized' : tier})`));
  });
}

test('the node\'s own root carries pointer-events:auto, overriding the canvas\'s pointer-events:none wrapper', () => {
  const html = render('planning', 'planning', 'Planning');
  assert.ok(
    html.includes('pointer-events:auto'),
    'the canvas sets elementsSelectable/nodesDraggable false, which makes React Flow set ' +
      "pointer-events:none on the .react-flow__node wrapper — this node's own root must " +
      'override that explicitly or a real pointer click never reaches onClick',
  );
});

test('a portfolio-root node shows the Portfolio badge and no pipeline status badge', () => {
  const html = render('not_initialized', 'not_initialized', 'Not Initialized', 'portfolio');
  assert.ok(html.includes('Project kind: Portfolio'), 'renders the Portfolio badge');
  assert.ok(!html.includes('Pipeline status:'), 'must not also render the pipeline state badge');
});

test('a standard project node is unchanged: it shows the pipeline status badge, not a Portfolio badge', () => {
  const html = render('execution', 'executing', 'Executing', 'standard');
  assert.ok(html.includes('Pipeline status: Executing'), 'renders the pipeline state badge as before');
  assert.ok(!html.includes('Project kind: Portfolio'), 'must not render a Portfolio badge for a standard project');
});

// ─── jsdom-mounted click behavior ──────────────────────────────────────────

function setupDom(): { container: HTMLDivElement; root: Root } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: 'http://localhost:3000/work-graph-poc',
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
  const container = dom.window.document.getElementById('root') as HTMLDivElement;
  return { container, root: createRoot(container) };
}

test('clicking the mounted node navigates to the project via router.push', async () => {
  const { container, root } = setupDom();
  try {
    const data: WorkGraphProjectData = {
      id: 'TELEMETRY-5', label: 'Telemetry Five', tier: 'planning', state: 'planning', stateLabel: 'Planning',
      projectType: 'standard',
    };
    await act(async () => {
      root.render(createElement(ReactFlowProvider, null, createElement(MockedNode, { data })));
    });

    const nodeEl = container.querySelector('[role="link"]') as HTMLElement | null;
    assert.ok(nodeEl, 'the node root div (role="link") must be present in the mounted tree');

    act(() => { nodeEl!.click(); });

    assert.deepEqual(pushCalls, ['/projects/TELEMETRY-5']);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('pressing Enter on the mounted node navigates to the project via router.push', async () => {
  const { container, root } = setupDom();
  try {
    const data: WorkGraphProjectData = {
      id: 'TELEMETRY-5', label: 'Telemetry Five', tier: 'planning', state: 'planning', stateLabel: 'Planning',
      projectType: 'standard',
    };
    await act(async () => {
      root.render(createElement(ReactFlowProvider, null, createElement(MockedNode, { data })));
    });

    const nodeEl = container.querySelector('[role="link"]') as HTMLElement | null;
    assert.ok(nodeEl, 'the node root div (role="link") must be present in the mounted tree');

    act(() => {
      const KeyboardEventCtor = (globalThis as unknown as { window: { KeyboardEvent: typeof KeyboardEvent } }).window
        .KeyboardEvent;
      nodeEl!.dispatchEvent(new KeyboardEventCtor('keydown', { key: 'Enter', bubbles: true }));
    });

    assert.deepEqual(pushCalls, ['/projects/TELEMETRY-5']);
  } finally {
    await act(async () => { root.unmount(); });
  }
});
