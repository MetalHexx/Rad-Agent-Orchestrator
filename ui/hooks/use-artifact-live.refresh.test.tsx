import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ArtifactLiveProvider, useArtifactLive } from './use-artifact-live';
import { SSEContext } from '@/hooks/use-sse-context';
import type { SSEEvent } from '@/types/events';

// Behavior of refreshSnapshot when responses arrive out of order or fail: the
// snapshot the reader sees must always be the freshest successful one for the
// project they're on.

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

/** Drain the microtask chain inside fetchArtifactSnapshot (fetch → res.json). */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function deferred(): { promise: Promise<Response>; resolve: (r: Response) => void } {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}

function filesResponse(
  files: string[],
  mtimes: Record<string, number>,
  requirementsStatus: string | null = null,
): Response {
  return { ok: true, json: async () => ({ files, mtimes, requirementsStatus }) } as unknown as Response;
}

function failedResponse(): Response {
  return { ok: false, json: async () => ({}) } as unknown as Response;
}

/** Serves each project name a queue of /files responses, one per request, so a
 *  test can tell an earlier request for a project apart from a later one. */
function seedFiles(queues: Record<string, Array<Promise<Response> | Response>>): () => void {
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (url: string) => {
    const match = /^\/api\/projects\/([^/]+)\/files$/.exec(String(url));
    if (match) {
      const next = queues[decodeURIComponent(match[1])]?.shift();
      if (next) return next;
    }
    return failedResponse();
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

function artifactChange(projectName: string): SSEEvent {
  return {
    type: 'artifact_change',
    timestamp: '2026-01-01T00:00:00Z',
    payload: { projectName, kind: 'changed' },
  } as SSEEvent;
}

type LiveValue = ReturnType<typeof useArtifactLive>;
let latest: LiveValue | null = null;

function Probe() {
  latest = useArtifactLive();
  return null;
}

function tree(projectName: string | null, sse: ReturnType<typeof sseHarness>) {
  return (
    <SSEContext.Provider value={sse.value}>
      <ArtifactLiveProvider projectName={projectName} activeFileName={null} hasTimeline={false}>
        <Probe />
      </ArtifactLiveProvider>
    </SSEContext.Provider>
  );
}

test('a straggling snapshot for a project the reader returned to never clobbers the newer one (A→B→A)', async () => {
  const firstA = deferred();
  const secondA = deferred();
  const beta = deferred();
  const restore = seedFiles({
    A: [firstA.promise, secondA.promise, filesResponse(['fresh.html'], { 'fresh.html': 20 })],
    B: [beta.promise],
  });
  const sse = sseHarness();
  const root = setupDom();
  try {
    await act(async () => { root.render(tree('A', sse)); });
    await act(async () => { root.render(tree('B', sse)); });
    await act(async () => { root.render(tree('A', sse)); });

    // The second A visit answers first; A's original (never-cancelled) request
    // straggles in behind it. Owner-name equality can't tell the two apart.
    await act(async () => {
      secondA.resolve(filesResponse(['fresh.html'], { 'fresh.html': 20 }));
      await flush();
      firstA.resolve(filesResponse(['stale.html'], { 'stale.html': 10 }));
      await flush();
    });

    assert.deepEqual(latest!.files, ['fresh.html'], 'the stale same-project response must not overwrite the newer snapshot');
    assert.deepEqual(latest!.mtimes, { 'fresh.html': 20 });

    // The straggler must not have become the diff baseline either: a live refresh
    // returning the SAME files it already knows about has nothing to pulse or badge.
    await act(async () => { sse.emit(artifactChange('A')); await flush(); });

    assert.equal(latest!.activePulse.size, 0, 'a stale-clobbered baseline would diff every file as added/removed');
    assert.equal(latest!.unseen.size, 0, 'and would badge them unseen');
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});

test('a failed live refresh preserves the already-loaded snapshot instead of blanking it', async () => {
  const restore = seedFiles({
    A: [filesResponse(['one.html', 'two.md'], { 'one.html': 5, 'two.md': 7 }, 'active'), failedResponse()],
  });
  const sse = sseHarness();
  const root = setupDom();
  try {
    await act(async () => { root.render(tree('A', sse)); });
    await act(async () => { await flush(); });

    assert.deepEqual(latest!.files, ['one.html', 'two.md']);
    assert.equal(latest!.requirementsStatus, 'active', 'the snapshot carries its requirements status');
    assert.equal(latest!.snapshotLoaded, true);

    // A transient failure (network blip / 5xx) on a later refresh resolves to an
    // empty snapshot — which must not wipe the tiles and open doc already showing.
    await act(async () => { sse.emit(artifactChange('A')); await flush(); });

    assert.deepEqual(latest!.files, ['one.html', 'two.md'], 'the last good file list survives a failed refresh');
    assert.deepEqual(latest!.mtimes, { 'one.html': 5, 'two.md': 7 }, 'and so do its mtimes');
    assert.equal(latest!.requirementsStatus, 'active', 'and its requirements status');
    assert.equal(latest!.snapshotLoaded, true);
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});

test('a failed first fetch still settles the project as loaded so the UI reveals', async () => {
  const restore = seedFiles({ A: [failedResponse()] });
  const sse = sseHarness();
  const root = setupDom();
  try {
    await act(async () => { root.render(tree('A', sse)); });
    await act(async () => { await flush(); });

    assert.equal(latest!.snapshotLoaded, true, 'with no prior data the empty result still settles — no endless skeleton');
    assert.deepEqual(latest!.files, []);
  } finally {
    await act(async () => { root.unmount(); });
    restore();
  }
});
