import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDebriefLaunch, type UseDebriefLaunchReturn } from './use-debrief-launch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function setupDom(): Root {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: 'http://localhost:3000/projects',
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
  return createRoot(dom.window.document.getElementById('root') as HTMLDivElement);
}

function seedFetch(handler: (url: string, init: RequestInit | undefined) => Response): () => void {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => handler(url, init);
  return () => { globalThis.fetch = originalFetch; };
}

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({ launched: true, platform: 'win32' }) } as unknown as Response;
}

function failedResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

let latest: UseDebriefLaunchReturn | null = null;

function Probe() {
  latest = useDebriefLaunch();
  return null;
}

test('launchDebrief resolves true on a successful post', async () => {
  const restore = seedFetch(() => okResponse());
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    let resolved: boolean | undefined;
    await act(async () => { resolved = await latest!.launchDebrief('DEMO', 'claude'); });
    assert.equal(resolved, true);
    assert.equal(latest!.error, null);
    assert.equal(latest!.isPending, false);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('launchDebrief resolves false and surfaces an error on a 500', async () => {
  const restore = seedFetch(() => failedResponse(500, { error: 'Terminal launch failed' }));
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    let resolved: boolean | undefined;
    await act(async () => { resolved = await latest!.launchDebrief('DEMO', 'claude'); });
    assert.equal(resolved, false);
    assert.equal(latest!.error, 'Terminal launch failed');
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('the request body carries only harness', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const restore = seedFetch((url, init) => { capturedUrl = url; capturedInit = init; return okResponse(); });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    await act(async () => { await latest!.launchDebrief('DEMO PROJECT', 'copilot'); });
    assert.ok(capturedUrl.includes('/api/projects/DEMO%20PROJECT/debrief/launch'), `expected encoded project name in ${capturedUrl}`);
    assert.equal(capturedInit?.method, 'POST');
    const headers = capturedInit?.headers as Record<string, string> | undefined;
    assert.equal(headers?.['Content-Type'], 'application/json');
    assert.equal(capturedInit?.body, JSON.stringify({ harness: 'copilot' }));
    assert.deepEqual(JSON.parse(capturedInit?.body as string), { harness: 'copilot' });
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('clearError resets the error state', async () => {
  const restore = seedFetch(() => failedResponse(500, { error: 'boom' }));
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    await act(async () => { await latest!.launchDebrief('DEMO', 'claude'); });
    assert.notEqual(latest!.error, null);
    await act(async () => { latest!.clearError(); });
    assert.equal(latest!.error, null);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});
