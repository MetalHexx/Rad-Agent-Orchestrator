import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSessionJourney, type UseSessionJourneyReturn } from './use-session-journey';
import { SSEContext } from '@/hooks/use-sse-context';
import type { SSEEvent } from '@/types/events';

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

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function deferred(): { promise: Promise<Response>; resolve: (r: Response) => void } {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}

function journeyResponse(sessions: unknown[], totalActiveTimeMs = 0): Response {
  return { ok: true, json: async () => ({ sessions, totalActiveTimeMs }) } as unknown as Response;
}

/** Serves each project name a queue of /sessions responses, one per request. */
function seedSessions(queues: Record<string, Array<Promise<Response> | Response>>): () => void {
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (url: string) => {
    const match = /^\/api\/projects\/([^/]+)\/sessions$/.exec(String(url));
    if (match) {
      const next = queues[decodeURIComponent(match[1])]?.shift();
      if (next) return next;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  };
  return () => { global.fetch = originalFetch; };
}

function sseHarness() {
  let listener: ((e: SSEEvent) => void) | null = null;
  return {
    value: {
      sseStatus: 'connected' as const,
      reconnect: () => {},
      subscribe: (l: (e: SSEEvent) => void) => {
        listener = l;
        return () => { if (listener === l) listener = null; };
      },
    },
    emit: (e: SSEEvent) => { if (listener) listener(e); },
  };
}

function sessionsChange(projectName: string): SSEEvent {
  return {
    type: 'sessions_change',
    timestamp: '2026-01-01T00:00:00Z',
    payload: { projectName },
  } as SSEEvent;
}

let latest: UseSessionJourneyReturn | null = null;

function Probe({ projectName }: { projectName: string }) {
  latest = useSessionJourney(projectName);
  return null;
}

function tree(projectName: string, sse: ReturnType<typeof sseHarness>) {
  return (
    <SSEContext.Provider value={sse.value}>
      <Probe projectName={projectName} />
    </SSEContext.Provider>
  );
}

test('fetches the journey on mount and settles loaded once it resolves', async () => {
  const first = deferred();
  const restore = seedSessions({ A: [first.promise] });
  const sse = sseHarness();
  const root = setupDom();
  try {
    await act(async () => { root.render(tree('A', sse)); });
    assert.equal(latest!.loaded, false, 'not loaded until the fetch resolves');
    await act(async () => {
      first.resolve(journeyResponse([{ sessionId: 's1' }], 42));
      await flush();
    });
    assert.equal(latest!.loaded, true);
    assert.equal(latest!.sessions.length, 1);
    assert.equal(latest!.totalActiveTimeMs, 42);
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});

test('refetches when a sessions_change event names the current project', async () => {
  const restore = seedSessions({
    A: [journeyResponse([], 0), journeyResponse([{ sessionId: 's1' }, { sessionId: 's2' }], 100)],
  });
  const sse = sseHarness();
  const root = setupDom();
  try {
    await act(async () => { root.render(tree('A', sse)); });
    await act(async () => { await flush(); });
    assert.equal(latest!.sessions.length, 0);

    await act(async () => { sse.emit(sessionsChange('A')); await flush(); });
    assert.equal(latest!.sessions.length, 2, 'the matching nudge triggered a refetch');
    assert.equal(latest!.totalActiveTimeMs, 100);
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});

test('ignores a sessions_change event for a different project', async () => {
  const restore = seedSessions({
    A: [journeyResponse([], 0), journeyResponse([{ sessionId: 'should-not-appear' }], 999)],
  });
  const sse = sseHarness();
  const root = setupDom();
  try {
    await act(async () => { root.render(tree('A', sse)); });
    await act(async () => { await flush(); });
    assert.equal(latest!.sessions.length, 0);

    await act(async () => { sse.emit(sessionsChange('OTHER-PROJECT')); await flush(); });
    assert.equal(latest!.sessions.length, 0, 'an unrelated project nudge triggers no refetch');
    assert.equal(latest!.totalActiveTimeMs, 0);
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});

test('a straggling response for a project the reader switched away from never commits', async () => {
  const slowA = deferred();
  const restore = seedSessions({
    A: [slowA.promise],
    B: [journeyResponse([{ sessionId: 'b1' }], 5)],
  });
  const sse = sseHarness();
  const root = setupDom();
  try {
    await act(async () => { root.render(tree('A', sse)); });
    await act(async () => { root.render(tree('B', sse)); });
    await act(async () => { await flush(); });

    assert.equal(latest!.loaded, true, 'B settled');
    assert.deepEqual(latest!.sessions, [{ sessionId: 'b1' }]);

    await act(async () => {
      slowA.resolve(journeyResponse([{ sessionId: 'stale-a' }], 999));
      await flush();
    });

    assert.deepEqual(latest!.sessions, [{ sessionId: 'b1' }], "A's late response must not clobber B's committed state");
    assert.equal(latest!.totalActiveTimeMs, 5);
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});
