import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDeleteProject, type UseDeleteProjectReturn } from './use-delete-project';
import type { DeletionPlan, DeletionReport, DeletionSkip } from '@rad-orchestration/work-graph';

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

function seedFetch(handler: (url: string, init: RequestInit | undefined) => Response): () => void {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => handler(url, init);
  return () => { globalThis.fetch = originalFetch; };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function failedResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

/** A promise plus its external resolver, for controlling fetch resolution order in tests. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/** Same convention as seedFetch, but hands out one promise per call in order (last one repeats). */
function seedFetchQueue(responses: Array<Promise<Response>>): () => void {
  const originalFetch = globalThis.fetch;
  let call = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return next;
  };
  return () => { globalThis.fetch = originalFetch; };
}

const plan: DeletionPlan = {
  project: 'DEMO PROJECT',
  items: [
    { kind: 'project-dir', label: 'Project directory', path: '/p', exists: true, disposition: 'remove' },
  ],
};

function completeReport(): DeletionReport {
  return {
    project: 'DEMO PROJECT',
    items: [
      { kind: 'project-dir', label: 'Project directory', path: '/p', exists: true, disposition: 'remove', outcome: 'removed' },
    ],
    complete: true,
  };
}

function partialReport(): DeletionReport {
  return {
    project: 'DEMO PROJECT',
    items: [
      { kind: 'project-dir', label: 'Project directory', path: '/p', exists: true, disposition: 'remove', outcome: 'failed', error: 'busy' },
    ],
    complete: false,
  };
}

let latest: UseDeleteProjectReturn | null = null;

function Probe({ projectName }: { projectName: string }) {
  latest = useDeleteProject(projectName);
  return null;
}

test('loadPlan() populates plan from the { plan } response shape and URL-encodes the project name', async () => {
  let capturedUrl = '';
  const restore = seedFetch((url) => { capturedUrl = url; return okResponse({ plan }); });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO PROJECT' })); });
    await act(async () => { await latest!.loadPlan(); });
    assert.deepEqual(latest!.plan, plan);
    assert.equal(latest!.planError, null);
    assert.ok(capturedUrl.includes('/api/projects/DEMO%20PROJECT/remove'), `expected encoded project name in ${capturedUrl}`);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('loadPlan() on a non-2xx response surfaces the body\'s error string', async () => {
  const restore = seedFetch(() => failedResponse(404, { error: 'Unknown project' }));
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'GONE' })); });
    await act(async () => { await latest!.loadPlan(); });
    assert.equal(latest!.plan, null);
    assert.equal(latest!.planError, 'Unknown project');
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('confirm() resolves report.complete === true and stores the report', async () => {
  const restore = seedFetch(() => okResponse({ report: completeReport() }));
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });
    let resolved: boolean | undefined;
    await act(async () => { resolved = await latest!.confirm(); });
    assert.equal(resolved, true);
    assert.equal(latest!.report?.complete, true);
    assert.equal(latest!.isPending, false);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('confirm() resolves report.complete === false on a partial delete', async () => {
  const restore = seedFetch(() => okResponse({ report: partialReport() }));
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });
    let resolved: boolean | undefined;
    await act(async () => { resolved = await latest!.confirm(); });
    assert.equal(resolved, false);
    assert.equal(latest!.report?.complete, false);
    assert.equal(latest!.report?.items[0]?.outcome, 'failed');
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('confirm() on a non-2xx response surfaces the body\'s error and resolves false', async () => {
  const restore = seedFetch(() => failedResponse(500, { error: 'Delete crashed' }));
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });
    let resolved: boolean | undefined;
    await act(async () => { resolved = await latest!.confirm(); });
    assert.equal(resolved, false);
    assert.equal(latest!.planError, 'Delete crashed');
    assert.equal(latest!.report, null);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('confirm(skip) puts the selection on the request body as JSON', async () => {
  let capturedInit: RequestInit | undefined;
  const restore = seedFetch((_url, init) => { capturedInit = init; return okResponse({ report: completeReport() }); });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });
    const skip: DeletionSkip[] = [{ kind: 'worktree', label: 'repo-a' }];
    await act(async () => { await latest!.confirm(skip); });
    assert.equal(capturedInit?.method, 'POST');
    const headers = capturedInit?.headers as Record<string, string> | undefined;
    assert.equal(headers?.['Content-Type'], 'application/json');
    assert.equal(capturedInit?.body, JSON.stringify({ skip }));
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('confirm() with nothing selected sends no body', async () => {
  let capturedInit: RequestInit | undefined;
  const restore = seedFetch((_url, init) => { capturedInit = init; return okResponse({ report: completeReport() }); });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });
    await act(async () => { await latest!.confirm(); });
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(capturedInit?.body, undefined);
    assert.equal(capturedInit?.headers, undefined);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('confirm([]) with an empty selection also sends no body', async () => {
  let capturedInit: RequestInit | undefined;
  const restore = seedFetch((_url, init) => { capturedInit = init; return okResponse({ report: completeReport() }); });
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });
    await act(async () => { await latest!.confirm([]); });
    assert.equal(capturedInit?.body, undefined);
    assert.equal(capturedInit?.headers, undefined);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('reset() clears plan, planError, and report', async () => {
  const restore = seedFetch(() => okResponse({ plan }));
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });
    await act(async () => { await latest!.loadPlan(); });
    assert.notEqual(latest!.plan, null);

    await act(async () => { latest!.reset(); });
    assert.equal(latest!.plan, null);
    assert.equal(latest!.planError, null);
    assert.equal(latest!.report, null);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('loadPlan() resolving after reset() must not apply the stale plan', async () => {
  const pending = deferred<Response>();
  const restore = seedFetch(() => pending.promise as unknown as Response);
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });

    let loadPlanPromise!: Promise<void>;
    await act(async () => {
      loadPlanPromise = latest!.loadPlan();
      await flush();
    });

    await act(async () => { latest!.reset(); });
    assert.equal(latest!.plan, null);
    assert.equal(latest!.planError, null);

    await act(async () => {
      pending.resolve(okResponse({ plan }));
      await loadPlanPromise;
      await flush();
    });

    assert.equal(latest!.plan, null, 'stale loadPlan() response must not overwrite the post-reset state');
    assert.equal(latest!.planError, null);
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('two loadPlan() calls resolving out of order: final state reflects the second (later) call', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const restore = seedFetchQueue([first.promise, second.promise]);
  const root = setupDom();
  const planA: DeletionPlan = { project: 'A', items: [] };
  const planB: DeletionPlan = { project: 'B', items: [] };
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });

    let firstCall!: Promise<void>;
    let secondCall!: Promise<void>;
    await act(async () => {
      firstCall = latest!.loadPlan();
      await flush();
      secondCall = latest!.loadPlan();
      await flush();
    });

    // Second call's fetch resolves first.
    await act(async () => {
      second.resolve(okResponse({ plan: planB }));
      await secondCall;
      await flush();
    });
    assert.deepEqual(latest!.plan, planB);

    // First call's fetch resolves late — must be discarded as stale.
    await act(async () => {
      first.resolve(okResponse({ plan: planA }));
      await firstCall;
      await flush();
    });

    assert.deepEqual(latest!.plan, planB, "the first call's late response must not overwrite the second call's result");
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('confirm() resolving after reset() must not apply the stale report', async () => {
  const pending = deferred<Response>();
  const restore = seedFetch(() => pending.promise as unknown as Response);
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });

    let confirmPromise!: Promise<boolean>;
    await act(async () => {
      confirmPromise = latest!.confirm();
      await flush();
    });

    await act(async () => { latest!.reset(); });
    assert.equal(latest!.report, null);

    await act(async () => {
      pending.resolve(okResponse({ report: completeReport() }));
      await confirmPromise;
      await flush();
    });

    assert.equal(latest!.report, null, 'stale confirm() response must not overwrite the post-reset state');
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('two confirm() calls resolving out of order: final state reflects the second (later) call', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const restore = seedFetchQueue([first.promise, second.promise]);
  const root = setupDom();
  try {
    await act(async () => { root.render(React.createElement(Probe, { projectName: 'DEMO' })); });

    let firstCall!: Promise<boolean>;
    let secondCall!: Promise<boolean>;
    await act(async () => {
      firstCall = latest!.confirm();
      await flush();
      secondCall = latest!.confirm();
      await flush();
    });

    // Second call's fetch resolves first, with a complete report.
    await act(async () => {
      second.resolve(okResponse({ report: completeReport() }));
      await secondCall;
      await flush();
    });
    assert.equal(latest!.report?.complete, true);

    // First call's fetch resolves late, with a partial report — must be discarded as stale.
    await act(async () => {
      first.resolve(okResponse({ report: partialReport() }));
      await firstCall;
      await flush();
    });

    assert.equal(latest!.report?.complete, true, "the first call's late response must not overwrite the second call's result");
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});
