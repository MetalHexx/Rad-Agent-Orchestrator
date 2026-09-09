/**
 * URL round-trip coverage for WorkGraphPocPage: the three toolbar controls
 * (Group, Start from, Filter) must compose through `router.replace` into
 * `?group=`/`?start=`/`?q=` without clobbering one another, and the debounced
 * filter (not every keystroke) is what reaches the URL.
 *
 * The real canvas (`work-graph-canvas.tsx`) pulls in `@xyflow/react`'s CSS,
 * which this repo's plain `node --test` + tsx harness cannot load (no bundler
 * CSS loader) — next/dynamic's default export is swapped for a stub so the
 * page's own logic (state, effects, toolbar wiring) is exercised without ever
 * evaluating that module.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import WorkGraphPocPage from './page';
import type { WorkGraphResponse } from '@/types/work-graph';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// A real value reference (not just a type import) so esbuild's unused-import
// elision can't drop this import — its side effect of populating require.cache
// (page.tsx, transitively next/navigation and next/dynamic) is exactly what
// loadMockedPage below depends on.
assert.strictEqual(WorkGraphPocPage.name, 'WorkGraphPocPage');

let replaceCalls: string[] = [];
let canvasProps: { scope: string; filter: string; startFrom: string } | null = null;

/**
 * tsx compiles imports to CJS require(), so require.cache is accessible — the
 * same require-cache-swap technique app-header.test.tsx/page.project-switch.test.tsx
 * use for next/navigation. next/dynamic is swapped the same way so the page's
 * lazily-imported canvas never actually loads.
 */
function loadMockedPage(): typeof WorkGraphPocPage {
  const req = require as NodeRequire & { cache: Record<string, { exports: unknown } | undefined> };
  const navPath = req.resolve('next/navigation');
  const dynamicPath = req.resolve('next/dynamic');
  const pagePath = req.resolve('./page');
  const origNavExports = req.cache[navPath]?.exports;
  const origDynamicExports = req.cache[dynamicPath]?.exports;
  assert.ok(origNavExports, 'next/navigation must be in require cache before mock');
  assert.ok(origDynamicExports, 'next/dynamic must be in require cache before mock');

  const navMock = Object.create(origNavExports as object) as Record<string, unknown>;
  Object.defineProperty(navMock, 'useSearchParams', {
    value: () => new URLSearchParams(window.location.search),
    writable: true,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(navMock, 'useRouter', {
    value: () => ({
      replace: (href: string) => {
        replaceCalls.push(href);
        window.history.replaceState(null, '', href);
      },
    }),
    writable: true,
    enumerable: true,
    configurable: true,
  });

  function StubCanvas(props: { scope: string; filter: string; startFrom: string }) {
    canvasProps = props;
    return React.createElement('div', { 'data-testid': 'canvas-stub' });
  }
  const dynamicMock: Record<string, unknown> = {
    __esModule: true,
    default: () => StubCanvas,
    noSSR: (origDynamicExports as { noSSR?: unknown }).noSSR,
  };

  req.cache[navPath]!.exports = navMock;
  req.cache[dynamicPath]!.exports = dynamicMock;
  delete req.cache[pagePath];
  try {
    const fresh = req('./page') as { default: typeof WorkGraphPocPage };
    return fresh.default;
  } finally {
    req.cache[navPath]!.exports = origNavExports;
    req.cache[dynamicPath]!.exports = origDynamicExports;
  }
}

let MockedPage: typeof WorkGraphPocPage;
before(() => {
  MockedPage = loadMockedPage();
});

function setupDom(url: string): { container: HTMLDivElement; root: Root } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: `http://localhost:3000${url}`,
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
  const container = dom.window.document.getElementById('root') as HTMLDivElement;
  return { container, root: createRoot(container) };
}

function graphResponse(): WorkGraphResponse {
  return {
    schema: 'work-graph/v1',
    nodes: [],
    edges: [],
    groups: [{ id: 'group:telemetry', name: 'Telemetry' }],
    danglingEdgeCount: 1,
  };
}

function installFetchStub(): () => void {
  const original = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => new Response(JSON.stringify(graphResponse()), { status: 200 });
  return () => { globalThis.fetch = original; };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function selectByLabel(container: HTMLElement, labelText: string): HTMLSelectElement {
  const labels = Array.from(container.querySelectorAll('label'));
  const label = labels.find((l) => l.textContent === labelText);
  assert.ok(label, `label "${labelText}" not found`);
  const select = container.querySelector(`[id="${(label as HTMLLabelElement).htmlFor}"]`) as HTMLSelectElement | null;
  assert.ok(select, `select for label "${labelText}" not found`);
  return select;
}

function inputByLabel(container: HTMLElement, labelText: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll('label'));
  const label = labels.find((l) => l.textContent === labelText);
  assert.ok(label, `label "${labelText}" not found`);
  const input = container.querySelector(`[id="${(label as HTMLLabelElement).htmlFor}"]`) as HTMLInputElement | null;
  assert.ok(input, `input for label "${labelText}" not found`);
  return input;
}

function fireSelectChange(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

/** See work-graph-toolbar.test.tsx's fireCheckboxChange for why "click" (not
 *  "change") is the event React's ChangeEventPlugin listens for on checkboxes. */
function fireCheckboxChange(el: HTMLInputElement, checked: boolean): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')!.set!;
  setter.call(el, checked);
  el.dispatchEvent(new window.Event('click', { bubbles: true }));
}

/** See work-graph-toolbar.test.tsx's fireInputChange for why this shape is needed
 *  under this suite's per-test jsdom setup (react-dom's dev build permanently
 *  resolves onto its legacy IE9 input-tracking fallback, decided once at its own
 *  module-load time before `window`/`document` exist). */
function fireInputChange(el: HTMLInputElement, value: string): void {
  const withLegacyIEShim = el as HTMLInputElement & { attachEvent?: () => void; detachEvent?: () => void };
  withLegacyIEShim.attachEvent ??= () => {};
  withLegacyIEShim.detachEvent ??= () => {};
  el.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new window.Event('keyup', { bubbles: true }));
}

test('selecting a Group replaces the URL with ?group= and clears it back to bare on "All"', async () => {
  replaceCalls = [];
  const restoreFetch = installFetchStub();
  const { container, root } = setupDom('/work-graph-poc');
  try {
    await act(async () => { root.render(React.createElement(MockedPage)); });
    await act(async () => { await flush(); });

    act(() => { fireSelectChange(selectByLabel(container, 'Group'), 'group:telemetry'); });
    assert.deepEqual(replaceCalls, ['/work-graph-poc?group=group%3Atelemetry']);

    act(() => { fireSelectChange(selectByLabel(container, 'Group'), 'all'); });
    assert.deepEqual(replaceCalls, ['/work-graph-poc?group=group%3Atelemetry', '/work-graph-poc']);
  } finally {
    await act(async () => { root.unmount(); });
    restoreFetch();
  }
});

test('selecting Start from "Newest" replaces the URL with ?start=newest', async () => {
  replaceCalls = [];
  const restoreFetch = installFetchStub();
  const { container, root } = setupDom('/work-graph-poc');
  try {
    await act(async () => { root.render(React.createElement(MockedPage)); });
    await act(async () => { await flush(); });

    act(() => { fireSelectChange(selectByLabel(container, 'Start from'), 'newest'); });
    assert.deepEqual(replaceCalls, ['/work-graph-poc?start=newest']);
  } finally {
    await act(async () => { root.unmount(); });
    restoreFetch();
  }
});

test('typing in Filter reaches the URL only once the debounce settles, not per keystroke', async () => {
  replaceCalls = [];
  const restoreFetch = installFetchStub();
  const { container, root } = setupDom('/work-graph-poc');
  try {
    await act(async () => { root.render(React.createElement(MockedPage)); });
    await act(async () => { await flush(); });

    act(() => { fireInputChange(inputByLabel(container, 'Filter'), 'telemetry-5'); });
    assert.deepEqual(replaceCalls, [], 'the raw keystroke must not reach the URL before the debounce settles');

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    assert.deepEqual(replaceCalls, ['/work-graph-poc?q=telemetry-5']);
  } finally {
    await act(async () => { root.unmount(); });
    restoreFetch();
  }
});

test('the three controls compose in the URL instead of clobbering one another', async () => {
  replaceCalls = [];
  const restoreFetch = installFetchStub();
  const { container, root } = setupDom('/work-graph-poc');
  try {
    await act(async () => { root.render(React.createElement(MockedPage)); });
    await act(async () => { await flush(); });

    act(() => { fireSelectChange(selectByLabel(container, 'Group'), 'group:telemetry'); });
    act(() => { fireSelectChange(selectByLabel(container, 'Start from'), 'newest'); });
    act(() => { fireInputChange(inputByLabel(container, 'Filter'), 'telemetry-5'); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });

    const finalUrl = new URL(window.location.href);
    assert.equal(finalUrl.searchParams.get('group'), 'group:telemetry');
    assert.equal(finalUrl.searchParams.get('start'), 'newest');
    assert.equal(finalUrl.searchParams.get('q'), 'telemetry-5');
  } finally {
    await act(async () => { root.unmount(); });
    restoreFetch();
  }
});

function requireCanvasProps(): { scope: string; filter: string; startFrom: string } {
  assert.ok(canvasProps, 'the canvas should have rendered once the fetch resolved');
  return canvasProps;
}

test('the debounced filter (not the raw keystroke) reaches the canvas', async () => {
  replaceCalls = [];
  canvasProps = null;
  const restoreFetch = installFetchStub();
  const { container, root } = setupDom('/work-graph-poc');
  try {
    await act(async () => { root.render(React.createElement(MockedPage)); });
    await act(async () => { await flush(); });
    assert.equal(requireCanvasProps().filter, '');

    act(() => { fireInputChange(inputByLabel(container, 'Filter'), 'telemetry-5'); });
    assert.equal(requireCanvasProps().filter, '', 'the canvas must not see the raw keystroke before the debounce settles');

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    assert.equal(requireCanvasProps().filter, 'telemetry-5');
  } finally {
    await act(async () => { root.unmount(); });
    restoreFetch();
  }
});

test('checking a non-default edge type writes ?edges=, and reloading that URL reproduces the same selection', async () => {
  replaceCalls = [];
  const restoreFetch = installFetchStub();
  const { container, root } = setupDom('/work-graph-poc');
  try {
    await act(async () => { root.render(React.createElement(MockedPage)); });
    await act(async () => { await flush(); });

    act(() => { fireCheckboxChange(inputByLabel(container, 'Spawned from'), true); });
    assert.deepEqual(replaceCalls, ['/work-graph-poc?edges=follows%2Cspawned-from']);
  } finally {
    await act(async () => { root.unmount(); });
    restoreFetch();
  }

  const restoreFetch2 = installFetchStub();
  const { container: reloaded, root: reloadedRoot } = setupDom('/work-graph-poc?edges=follows,spawned-from');
  try {
    await act(async () => { reloadedRoot.render(React.createElement(MockedPage)); });
    await act(async () => { await flush(); });

    assert.strictEqual(inputByLabel(reloaded, 'Follows').checked, true);
    assert.strictEqual(inputByLabel(reloaded, 'Spawned from').checked, true);
    assert.strictEqual(inputByLabel(reloaded, 'Depends on').checked, false);
    assert.strictEqual(inputByLabel(reloaded, 'Other').checked, false);
  } finally {
    await act(async () => { reloadedRoot.unmount(); });
    restoreFetch2();
  }
});

test('an initial ?q= in the URL pre-fills the Filter input on load', async () => {
  replaceCalls = [];
  const restoreFetch = installFetchStub();
  const { container, root } = setupDom('/work-graph-poc?q=initial-term');
  try {
    await act(async () => { root.render(React.createElement(MockedPage)); });
    await act(async () => { await flush(); });

    assert.equal(inputByLabel(container, 'Filter').value, 'initial-term');
  } finally {
    await act(async () => { root.unmount(); });
    restoreFetch();
  }
});
