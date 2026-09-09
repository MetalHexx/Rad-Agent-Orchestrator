import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  useProjectViewMode,
  PROJECT_VIEW_MODE_STORAGE_KEY,
  DEFAULT_PROJECT_VIEW_MODE,
  type ProjectViewMode,
} from './use-project-view-mode';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function setupDom(): Root {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: 'http://localhost:3000/projects',
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, writable: true, configurable: true });
  return createRoot(dom.window.document.getElementById('root') as HTMLDivElement);
}

/** Drain the microtask chain inside the hook's mount effect. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function throwingStorage(overrides: Partial<Storage> = {}): Storage {
  return {
    getItem() { throw new Error('localStorage unavailable'); },
    setItem() { throw new Error('localStorage unavailable'); },
    removeItem() { throw new Error('localStorage unavailable'); },
    clear() { throw new Error('localStorage unavailable'); },
    key() { throw new Error('localStorage unavailable'); },
    length: 0,
    ...overrides,
  } as Storage;
}

let latest: { mode: ProjectViewMode; setMode: (m: ProjectViewMode) => void } | null = null;

function Probe() {
  latest = useProjectViewMode();
  return null;
}

test('defaults to overview when nothing is stored', async () => {
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    await act(async () => { await flush(); });
    assert.equal(latest!.mode, DEFAULT_PROJECT_VIEW_MODE);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('restores a valid stored value', async () => {
  const root = setupDom();
  localStorage.setItem(PROJECT_VIEW_MODE_STORAGE_KEY, 'pipeline');
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    await act(async () => { await flush(); });
    assert.equal(latest!.mode, 'pipeline');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('falls back to the default on an unrecognised stored value', async () => {
  const root = setupDom();
  localStorage.setItem(PROJECT_VIEW_MODE_STORAGE_KEY, 'sideways');
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    await act(async () => { await flush(); });
    assert.equal(latest!.mode, DEFAULT_PROJECT_VIEW_MODE);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('a localStorage that throws on read degrades silently to the default', async () => {
  const root = setupDom();
  Object.defineProperty(globalThis, 'localStorage', { value: throwingStorage(), writable: true, configurable: true });
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    await act(async () => { await flush(); });
    assert.equal(latest!.mode, DEFAULT_PROJECT_VIEW_MODE);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('a localStorage that throws on write does not throw out of setMode', async () => {
  const root = setupDom();
  Object.defineProperty(globalThis, 'localStorage', {
    value: throwingStorage({ getItem: () => null }),
    writable: true,
    configurable: true,
  });
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    await act(async () => { await flush(); });
    await act(async () => { latest!.setMode('pipeline'); });
    assert.equal(latest!.mode, 'pipeline', 'state updates even though the write silently fails');
  } finally {
    await act(async () => { root.unmount(); });
  }
});
