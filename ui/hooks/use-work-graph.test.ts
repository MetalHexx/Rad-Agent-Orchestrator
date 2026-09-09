import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useWorkGraph, type UseWorkGraphResult } from './use-work-graph';
import type { WorkGraphResponse } from '@/types/work-graph';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function setupDom(): Root {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: 'http://localhost:3000/work-graph',
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
  return createRoot(dom.window.document.getElementById('root') as HTMLDivElement);
}

/** Drain the microtask chain inside the hook's effect (fetch -> res.json -> setState). */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function graphWithCount(danglingEdgeCount: number): WorkGraphResponse {
  return { schema: 'work-graph/v1', nodes: [], edges: [], groups: [], danglingEdgeCount };
}

function okResponse(body: WorkGraphResponse): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

function failedResponse(errorBody: unknown = { error: 'Failed to read the work graph.' }): Response {
  return { ok: false, json: async () => errorBody } as unknown as Response;
}

/** Serves each scope a queue of /api/work-graph responses, one per request, so a
 *  test can tell an earlier request for a scope apart from a later one. */
function seedFetch(queues: Record<string, Array<Promise<Response> | Response>>): () => void {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string) => {
    const match = /^\/api\/work-graph\?group=([^&]+)$/.exec(String(url));
    if (match) {
      const scope = decodeURIComponent(match[1]);
      const next = queues[scope]?.shift();
      if (next) return next;
    }
    throw new Error(`unseeded fetch: ${url}`);
  };
  return () => { globalThis.fetch = originalFetch; };
}

let latest: UseWorkGraphResult | null = null;

function Probe({ scope }: { scope: string }) {
  latest = useWorkGraph(scope);
  return null;
}

test('resolves the fetched graph, landing on status "loaded"', async () => {
  const restore = seedFetch({ all: [okResponse(graphWithCount(3))] });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { scope: 'all' })); });
    await act(async () => { await flush(); });

    assert.equal(latest!.status, 'loaded');
    assert.equal(latest!.data?.danglingEdgeCount, 3);
    assert.equal(latest!.errorMessage, '');
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});

test('a non-ok response sets status "error" with the body\'s message, never throwing', async () => {
  const restore = seedFetch({ all: [failedResponse({ error: 'Registry unreadable.' })] });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { scope: 'all' })); });
    await act(async () => { await flush(); });

    assert.equal(latest!.status, 'error');
    assert.equal(latest!.errorMessage, 'Registry unreadable.');
    assert.equal(latest!.data, null, 'a hard failure clears any previously retained data');
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});

test('a non-ok response with a non-JSON body falls back to a generic message', async () => {
  const badBody = { ok: false, json: async () => { throw new Error('not json'); } } as unknown as Response;
  const restore = seedFetch({ all: [badBody] });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { scope: 'all' })); });
    await act(async () => { await flush(); });

    assert.equal(latest!.status, 'error');
    assert.ok(latest!.errorMessage.length > 0, 'a generic fallback message is set rather than being left empty');
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});

test('a rejected fetch (network failure) is contained — status "error", no unhandled rejection', async () => {
  const restore = seedFetch({ all: [Promise.reject(new Error('offline'))] });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { scope: 'all' })); });
    await act(async () => { await flush(); });

    assert.equal(latest!.status, 'error');
    assert.equal(latest!.errorMessage, 'offline');
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});

test('a scope change supersedes an in-flight request — the stale response never lands', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const restore = seedFetch({
    'group-a': [first.promise],
    'group-b': [second.promise],
  });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { scope: 'group-a' })); });
    await act(async () => { root.render(React.createElement(Probe, { scope: 'group-b' })); });

    // The newer scope's request answers first.
    await act(async () => {
      second.resolve(okResponse(graphWithCount(2)));
      await flush();
    });
    assert.equal(latest!.status, 'loaded');
    assert.equal(latest!.data?.danglingEdgeCount, 2);

    // The superseded scope's request straggles in behind it.
    await act(async () => {
      first.resolve(okResponse(graphWithCount(1)));
      await flush();
    });

    assert.equal(latest!.status, 'loaded');
    assert.equal(
      latest!.data?.danglingEdgeCount, 2,
      'the stale group-a response must not overwrite the fresher group-b data',
    );
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});

test('retains the last successful data while a refetch for a new scope is in flight', async () => {
  const second = deferred<Response>();
  const restore = seedFetch({
    'group-a': [okResponse(graphWithCount(5))],
    'group-b': [second.promise],
  });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { scope: 'group-a' })); });
    await act(async () => { await flush(); });
    assert.equal(latest!.status, 'loaded');
    assert.equal(latest!.data?.danglingEdgeCount, 5);

    await act(async () => { root.render(React.createElement(Probe, { scope: 'group-b' })); });
    await act(async () => { await flush(); });

    assert.equal(latest!.status, 'loading', 'status returns to loading on a scope change');
    assert.equal(
      latest!.data?.danglingEdgeCount, 5,
      'data from the last successful load is retained while the new scope is in flight',
    );

    await act(async () => {
      second.resolve(okResponse(graphWithCount(9)));
      await flush();
    });
    assert.equal(latest!.status, 'loaded');
    assert.equal(latest!.data?.danglingEdgeCount, 9);
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});
