import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorkGraphToolbar } from './work-graph-toolbar';
import type { StartFrom, EdgeTypeKey } from '@/types/work-graph';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

function selectByLabel(container: HTMLElement, labelText: string): HTMLSelectElement {
  const labels = Array.from(container.querySelectorAll('label'));
  const label = labels.find((l) => l.textContent === labelText);
  assert.ok(label, `label "${labelText}" not found`);
  const htmlFor = (label as HTMLLabelElement).htmlFor;
  const select = container.querySelector(`[id="${htmlFor}"]`) as HTMLSelectElement | null;
  assert.ok(select, `select for label "${labelText}" not found`);
  return select;
}

function inputByLabel(container: HTMLElement, labelText: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll('label'));
  const label = labels.find((l) => l.textContent === labelText);
  assert.ok(label, `label "${labelText}" not found`);
  const htmlFor = (label as HTMLLabelElement).htmlFor;
  const input = container.querySelector(`[id="${htmlFor}"]`) as HTMLInputElement | null;
  assert.ok(input, `input for label "${labelText}" not found`);
  return input;
}

interface Harness {
  container: HTMLDivElement;
  root: Root;
  scopeCalls: string[];
  startFromCalls: StartFrom[];
  filterTextCalls: string[];
  edgeTypesCalls: EdgeTypeKey[][];
}

async function renderToolbar(enabledEdgeTypes: EdgeTypeKey[] = ['follows']): Promise<Harness> {
  const { container, root } = setupDom();
  const scopeCalls: string[] = [];
  const startFromCalls: StartFrom[] = [];
  const filterTextCalls: string[] = [];
  const edgeTypesCalls: EdgeTypeKey[][] = [];

  await act(async () => {
    root.render(
      React.createElement(WorkGraphToolbar, {
        groups: [{ id: 'group:telemetry', name: 'Telemetry' }],
        scope: 'all',
        startFrom: 'oldest',
        filterText: '',
        danglingEdgeCount: 2,
        enabledEdgeTypes,
        onScopeChange: (next: string) => scopeCalls.push(next),
        onStartFromChange: (next: StartFrom) => startFromCalls.push(next),
        onFilterTextChange: (next: string) => filterTextCalls.push(next),
        onEdgeTypesChange: (next: EdgeTypeKey[]) => edgeTypesCalls.push(next),
      }),
    );
  });

  return { container, root, scopeCalls, startFromCalls, filterTextCalls, edgeTypesCalls };
}

function setUntrackedValue(el: HTMLSelectElement | HTMLInputElement, value: string): void {
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
}

/**
 * Simulates a `<select>`'s onChange: React's ChangeEventPlugin listens to the
 * native "change" event directly for it, so setting the untracked value and
 * dispatching "change" is enough for React's own tracker-based dirty check to
 * fire the synthetic onChange.
 */
function fireSelectChange(el: HTMLSelectElement, value: string): void {
  setUntrackedValue(el, value);
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

/**
 * Simulates typing into a text <input>'s onChange. react-dom's dev build
 * decides once at its own module load, via `canUseDOM`/`isEventSupported`,
 * whether a real `input` event is available — since `window`/`document` in
 * this suite are only installed per-test (after react-dom already loaded),
 * that check permanently resolves to "no", pinning every text input onto
 * react-dom's legacy IE9 fallback (tracks value via "focusin" + "keyup", not
 * "input"/"change"). That fallback also unconditionally calls the
 * non-standard `element.attachEvent`, which jsdom doesn't implement — hence
 * the no-op shim before dispatching "focusin".
 */
function fireInputChange(el: HTMLInputElement, value: string): void {
  const withLegacyIEShim = el as HTMLInputElement & { attachEvent?: () => void; detachEvent?: () => void };
  withLegacyIEShim.attachEvent ??= () => {};
  withLegacyIEShim.detachEvent ??= () => {};
  el.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  setUntrackedValue(el, value);
  el.dispatchEvent(new window.Event('keyup', { bubbles: true }));
}

/** Simulates a checkbox's onChange the same way fireSelectChange does for a
 *  <select> — the "checked" setter is untracked, then the native event React's
 *  ChangeEventPlugin actually listens for on checkbox/radio inputs is
 *  dispatched: "click", not "change" (see shouldUseClickEvent upstream). */
function fireCheckboxChange(el: HTMLInputElement, checked: boolean): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')!.set!;
  setter.call(el, checked);
  el.dispatchEvent(new window.Event('click', { bubbles: true }));
}

test('changing the Group select fires onScopeChange with the selected group id', async () => {
  const { container, root, scopeCalls } = await renderToolbar();
  try {
    const select = selectByLabel(container, 'Group');
    act(() => { fireSelectChange(select, 'group:telemetry'); });
    assert.deepEqual(scopeCalls, ['group:telemetry']);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('changing the Start from select fires onStartFromChange with the selected value', async () => {
  const { container, root, startFromCalls } = await renderToolbar();
  try {
    const select = selectByLabel(container, 'Start from');
    act(() => { fireSelectChange(select, 'newest'); });
    assert.deepEqual(startFromCalls, ['newest']);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('typing in the Filter input fires onFilterTextChange with the raw (non-debounced) value', async () => {
  const { container, root, filterTextCalls } = await renderToolbar();
  try {
    const input = inputByLabel(container, 'Filter');
    act(() => { fireInputChange(input, 'telemetry-5'); });
    assert.deepEqual(filterTextCalls, ['telemetry-5']);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('the three controls fire independently of one another', async () => {
  const { container, root, scopeCalls, startFromCalls, filterTextCalls } = await renderToolbar();
  try {
    act(() => { fireSelectChange(selectByLabel(container, 'Group'), 'group:telemetry'); });
    act(() => { fireSelectChange(selectByLabel(container, 'Start from'), 'newest'); });
    act(() => { fireInputChange(inputByLabel(container, 'Filter'), 'telemetry'); });

    assert.deepEqual(scopeCalls, ['group:telemetry']);
    assert.deepEqual(startFromCalls, ['newest']);
    assert.deepEqual(filterTextCalls, ['telemetry']);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('renders exactly four edge-type rows, always, regardless of what the current view contains', async () => {
  const { container, root } = await renderToolbar();
  try {
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    assert.strictEqual(checkboxes.length, 4);
    for (const label of ['Follows', 'Depends on', 'Spawned from', 'Other']) {
      assert.ok(inputByLabel(container, label), `expected a labelled row for "${label}"`);
    }
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('the default enables only Follows', async () => {
  const { container, root } = await renderToolbar();
  try {
    assert.strictEqual(inputByLabel(container, 'Follows').checked, true);
    assert.strictEqual(inputByLabel(container, 'Depends on').checked, false);
    assert.strictEqual(inputByLabel(container, 'Spawned from').checked, false);
    assert.strictEqual(inputByLabel(container, 'Other').checked, false);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('checking a row fires onEdgeTypesChange with it added, without mutating local state', async () => {
  const { container, root, edgeTypesCalls } = await renderToolbar();
  try {
    const spawnedFrom = inputByLabel(container, 'Spawned from');
    act(() => { fireCheckboxChange(spawnedFrom, true); });

    assert.deepEqual(edgeTypesCalls, [['follows', 'spawned-from']]);
    // Fully controlled: the callback doesn't feed back into this render, so the
    // checkbox stays exactly as the (unchanged) `enabledEdgeTypes` prop says.
    assert.strictEqual(spawnedFrom.checked, false);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('unchecking the only enabled row fires onEdgeTypesChange with it removed', async () => {
  const { container, root, edgeTypesCalls } = await renderToolbar();
  try {
    act(() => { fireCheckboxChange(inputByLabel(container, 'Follows'), false); });
    assert.deepEqual(edgeTypesCalls, [[]]);
  } finally {
    await act(async () => { root.unmount(); });
  }
});
