import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useApproveGate, type UseApproveGateError } from './use-approve-gate';
import type { GateApproveResponse } from '@/types/state';

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

function okJsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function okUnparseableResponse(): Response {
  return { ok: true, status: 200, json: async () => { throw new Error('Unexpected end of JSON input'); } } as unknown as Response;
}

function failedResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

interface Approve {
  approveGate: (projectName: string, event: 'plan_approved' | 'final_approved') => Promise<GateApproveResponse | null>;
  isPending: boolean;
  error: UseApproveGateError | null;
  clearError: () => void;
}

let latest: Approve | null = null;

function Probe() {
  latest = useApproveGate();
  return null;
}

test('approveGate resolves the parsed response on success, including a portfolio field', async () => {
  const response: GateApproveResponse = { success: true, action: 'final_approved', portfolio: { name: 'PORTFOLIO-2' } };
  const restore = seedFetch(() => okJsonResponse(response));
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    let resolved: GateApproveResponse | null = null;
    await act(async () => { resolved = await latest!.approveGate('DEMO', 'final_approved'); });
    assert.deepEqual(resolved, response);
    assert.equal(latest!.error, null);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('approveGate resolves null on a non-2xx response and populates error', async () => {
  const restore = seedFetch(() => failedResponse(409, { error: 'Gate already fired', detail: 'raw pipeline output' }));
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    let resolved: GateApproveResponse | null | undefined;
    await act(async () => { resolved = await latest!.approveGate('DEMO', 'final_approved'); });
    assert.equal(resolved, null);
    assert.deepEqual(latest!.error, { message: 'Gate already fired', detail: 'raw pipeline output' });
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('approveGate resolves null on a network error and populates error', async () => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => { throw new Error('offline'); };
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    let resolved: GateApproveResponse | null | undefined;
    await act(async () => { resolved = await latest!.approveGate('DEMO', 'plan_approved'); });
    assert.equal(resolved, null);
    assert.ok(latest!.error?.message, 'a network error still populates a message');
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => { root.unmount(); });
  }
});

test('approveGate treats a 200 with an unparseable body as success — never null', async () => {
  const restore = seedFetch(() => okUnparseableResponse());
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    let resolved: GateApproveResponse | null | undefined;
    await act(async () => { resolved = await latest!.approveGate('DEMO', 'final_approved'); });
    assert.notEqual(resolved, null, 'a 200 must never resolve null, even with a body that fails to parse');
    assert.deepEqual(resolved, { success: true, action: '' });
    assert.equal(latest!.error, null, 'an unparseable 200 body is not an error state');
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
    await act(async () => { await latest!.approveGate('DEMO', 'plan_approved'); });
    assert.notEqual(latest!.error, null);
    await act(async () => { latest!.clearError(); });
    assert.equal(latest!.error, null);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});
