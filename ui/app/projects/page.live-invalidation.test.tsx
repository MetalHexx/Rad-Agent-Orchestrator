/**
 * Behavioral coverage for the mtime-keyed body-fetch invalidation contract
 * (P01-T01): a live snapshot refresh that advances the OPEN doc's own mtime
 * must refetch its body, one that only advances some OTHER file's mtime must
 * not, a failed `/files` fetch must still flip `snapshotLoaded` (so the plan
 * view reveals rather than hanging on the skeleton), and a confirmed delete
 * must issue a fresh snapshot fetch via `live.refresh()`.
 *
 * Reuses the full-page render harness page.project-switch.test.tsx
 * established (JSDOM + createRoot/act, and a fetch stub keyed per project),
 * extended with an injected SSEContext stub so an `artifact_change` can be
 * emitted without a real filesystem watcher — the seam the requirements'
 * fixture note asks for.
 */
import { test, before } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ProjectsPage from './[[...slug]]/page';
import { PROJECT_VIEW_MODE_STORAGE_KEY } from '@/hooks/use-project-view-mode';
import { SSEContext } from '@/hooks/use-sse-context';
import type { SSEEvent } from '@/types/events';
import type { ProjectSummary } from '@/types/components';
import type { ProjectStateV5 } from '@/types/state';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

assert.strictEqual(ProjectsPage.name, 'ProjectsPage', 'default export should be named ProjectsPage');

// ─── next/navigation mock (mirrors page.project-switch.test.tsx) ───────────

function loadMockedProjectsPage(): typeof ProjectsPage {
  const req = require as NodeRequire & { cache: Record<string, { exports: unknown } | undefined> };
  const navPath = req.resolve('next/navigation');
  const pagePath = req.resolve('./[[...slug]]/page');
  const useProjectsPath = req.resolve('@/hooks/use-projects');
  const origNavExports = req.cache[navPath]?.exports;
  assert.ok(origNavExports, 'next/navigation must be in require cache before mock');

  const mock = Object.create(origNavExports as object) as Record<string, unknown>;
  Object.defineProperty(mock, 'usePathname', {
    value: () => window.location.pathname,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(mock, 'useRouter', {
    value: () => ({ replace: () => {}, push: () => {} }),
    writable: true,
    enumerable: true,
    configurable: true,
  });

  req.cache[navPath]!.exports = mock;
  delete req.cache[pagePath];
  delete req.cache[useProjectsPath];
  try {
    const fresh = req('./[[...slug]]/page') as { default: typeof ProjectsPage };
    return fresh.default;
  } finally {
    req.cache[navPath]!.exports = origNavExports;
  }
}

let MockedProjectsPage: typeof ProjectsPage;
before(() => { MockedProjectsPage = loadMockedProjectsPage(); });

// ─── DOM harness ────────────────────────────────────────────────────────────

function setupDom(): { container: HTMLDivElement; root: Root } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: 'http://localhost:3000/projects',
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Node = dom.window.Node;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Element = dom.window.Element;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MouseEvent = dom.window.MouseEvent;
  Object.defineProperty(dom.window, 'innerWidth', { value: 1280, configurable: true });
  dom.window.matchMedia = (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  // `useProjectViewMode` reads the bare global `localStorage`; bridge it to
  // jsdom's, then seed 'pipeline' so this file's pre-existing DAG-specific
  // assertion (hasPipelineTimeline) keeps testing the Pipeline sub-view —
  // Overview is now the global default (P03-T03), but this suite is about
  // snapshot-fetch invalidation, not view-mode selection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = dom.window.localStorage;
  dom.window.localStorage.setItem(PROJECT_VIEW_MODE_STORAGE_KEY, 'pipeline');
  const container = dom.window.document.getElementById('root') as HTMLDivElement;
  const root = createRoot(container);
  return { container, root };
}

function mainContent(container: HTMLElement): HTMLElement {
  const el = container.querySelector('#main-content');
  assert.ok(el, 'main-content region not found');
  return el as HTMLElement;
}

function hasPipelineTimeline(el: HTMLElement): boolean {
  return el.querySelector('[role="listbox"][aria-label="Pipeline timeline"]') !== null;
}

// ─── SSE stub — lets a test emit an artifact_change without a real watcher ──

function installSSEStub() {
  const listeners = new Set<(event: SSEEvent) => void>();
  const value = {
    sseStatus: 'connected' as const,
    reconnect: () => {},
    subscribe: (listener: (event: SSEEvent) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    value,
    emit: (event: SSEEvent) => { for (const l of Array.from(listeners)) l(event); },
  };
}

function emitArtifactChange(sse: ReturnType<typeof installSSEStub>, projectName: string): void {
  sse.emit({
    type: 'artifact_change',
    timestamp: new Date().toISOString(),
    payload: { projectName, kind: 'changed' },
  });
}

// ─── Fetch stub ─────────────────────────────────────────────────────────────

interface FilesBody { files: string[]; mtimes: Record<string, number>; requirementsStatus: string | null; }

interface FetchFixtures {
  projects: ProjectSummary[];
  state?: Record<string, { status: number; body: unknown }>;
  /** Per-project response queue for GET .../files, consumed call-by-call (the
   *  last entry repeats): the baseline snapshot is call 1, each simulated
   *  `artifact_change` refresh consumes the next entry. */
  files?: Record<string, Array<{ status: number; body: FilesBody }>>;
}

function installFetchStub(fixtures: FetchFixtures) {
  const original = global.fetch;
  const filesCallIndex = new Map<string, number>();
  const documentCalls: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (input: string) => {
    const url = String(input);
    if (url.endsWith('/api/projects')) {
      return new Response(JSON.stringify({ projects: fixtures.projects }), { status: 200 });
    }
    if (url.includes('/api/registry')) {
      return new Response('{}', { status: 404 });
    }
    if (url.includes('/delete?path=')) {
      return new Response('{}', { status: 200 });
    }
    let m = url.match(/\/api\/projects\/([^/]+)\/state(?:\?.*)?$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const spec = fixtures.state?.[name] ?? { status: 404, body: {} };
      return new Response(JSON.stringify(spec.body), { status: spec.status });
    }
    m = url.match(/\/api\/projects\/([^/]+)\/files(?:\?.*)?$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const queue = fixtures.files?.[name] ?? [];
      const idx = filesCallIndex.get(name) ?? 0;
      filesCallIndex.set(name, idx + 1);
      const spec = queue[Math.min(idx, queue.length - 1)] ?? { status: 200, body: { files: [], mtimes: {}, requirementsStatus: null } };
      return new Response(JSON.stringify(spec.body), { status: spec.status });
    }
    if (url.match(/\/api\/projects\/([^/]+)\/document\?path=/)) {
      documentCalls.push(url);
      return new Response(JSON.stringify({ content: 'body', frontmatter: {} }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  return {
    restore: () => { global.fetch = original; },
    documentCalls,
    filesCallCount: (name: string) => filesCallIndex.get(name) ?? 0,
  };
}

// ─── Interaction helpers ────────────────────────────────────────────────────

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function waitPastPlaceholderFloor(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 400)); });
}

function clickProjectRow(container: HTMLElement, name: string): void {
  const options = Array.from(container.querySelectorAll('[role="option"]'));
  const target = options.find((el) => el.textContent?.includes(name)) as HTMLElement | undefined;
  assert.ok(target, `sidebar row for "${name}" not found`);
  act(() => { target!.click(); });
}

async function selectProjectAndSettle(container: HTMLElement, name: string): Promise<void> {
  clickProjectRow(container, name);
  await act(async () => { await flush(); });
  await waitPastPlaceholderFloor();
}

function unplannedSummary(name: string): ProjectSummary {
  return {
    name, tier: 'not_initialized', state: 'not_initialized', stateLabel: 'Not Initialized',
    hasState: false, hasMalformedState: false,
  };
}

function plannedSummary(name: string): ProjectSummary {
  return {
    name, tier: 'execution', state: 'pending_review', stateLabel: 'Pending Review',
    hasState: true, hasMalformedState: false, schemaVersion: 'v5',
  };
}

function buildV5State(name: string): ProjectStateV5 {
  return {
    $schema: 'orchestration-state-v5',
    project: { name, created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z' },
    config: {
      gate_mode: 'autonomous',
      limits: { max_phases: 3, max_tasks_per_phase: 5, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'autonomous', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'v5-template', status: 'in_progress', current_node_path: null, nodes: {} },
  };
}

function renderMockedPage(root: Root, sse: ReturnType<typeof installSSEStub>): Promise<void> {
  return act(async () => {
    root.render(
      <SSEContext.Provider value={sse.value}>
        <MockedProjectsPage />
      </SSEContext.Provider>,
    );
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("a live refresh that advances the open doc's own mtime refetches its body; advancing only another file's mtime does not", async () => {
  const sse = installSSEStub();
  const name = 'live-invalidation-mtime';
  const doc = `${name}-DOC.md`;
  const other = `${name}-OTHER.md`;
  const stub = installFetchStub({
    projects: [unplannedSummary(name)],
    files: {
      [name]: [
        { status: 200, body: { files: [doc, other], mtimes: { [doc]: 1, [other]: 1 }, requirementsStatus: null } },
        { status: 200, body: { files: [doc, other], mtimes: { [doc]: 1, [other]: 2 }, requirementsStatus: null } },
        { status: 200, body: { files: [doc, other], mtimes: { [doc]: 3, [other]: 2 }, requirementsStatus: null } },
      ],
    },
  });
  try {
    const { container, root } = setupDom();
    await renderMockedPage(root, sse);
    await act(async () => { await flush(); });
    const main = mainContent(container);

    await selectProjectAndSettle(container, name);

    act(() => {
      window.history.pushState(null, '', `/projects/${encodeURIComponent(name)}/docs/${encodeURIComponent(doc)}`);
    });
    await renderMockedPage(root, sse);
    await act(async () => { await flush(); });

    assert.ok(
      main.querySelector('[role="tablist"][aria-label="Artifacts"]'),
      'the deep-linked doc should resolve and open the modal',
    );
    assert.strictEqual(stub.documentCalls.length, 1, 'opening the doc fetches its body once');

    emitArtifactChange(sse, name);
    await act(async () => { await flush(); });
    assert.strictEqual(
      stub.documentCalls.length, 1,
      "a live refresh that only advances another file's mtime must not refetch the open doc",
    );

    emitArtifactChange(sse, name);
    await act(async () => { await flush(); });
    assert.strictEqual(
      stub.documentCalls.length, 2,
      "a live refresh that advances the open doc's own mtime must refetch its body",
    );

    act(() => { root.unmount(); });
  } finally {
    stub.restore();
  }
});

test("a failed /files fetch still flips snapshotLoaded, so the plan view reveals instead of hanging on the skeleton", async () => {
  const sse = installSSEStub();
  const name = 'live-invalidation-failed-snapshot';
  const stub = installFetchStub({
    projects: [plannedSummary(name)],
    state: { [name]: { status: 200, body: { state: buildV5State(name) } } },
    files: { [name]: [{ status: 500, body: { files: [], mtimes: {}, requirementsStatus: null } }] },
  });
  try {
    const { container, root } = setupDom();
    await renderMockedPage(root, sse);
    await act(async () => { await flush(); });
    const main = mainContent(container);

    await selectProjectAndSettle(container, name);

    assert.ok(
      hasPipelineTimeline(main),
      'the plan content must render even though the /files snapshot fetch failed',
    );

    act(() => { root.unmount(); });
  } finally {
    stub.restore();
  }
});

test('a doc created after the project page is open becomes clickable and opens on its first click, no reload (R3 repro)', async () => {
  const sse = installSSEStub();
  const name = 'live-invalidation-new-doc';
  const existing = `${name}-DOC.md`;
  const created = `${name}-NOTES.md`;
  const stub = installFetchStub({
    projects: [unplannedSummary(name)],
    files: {
      [name]: [
        { status: 200, body: { files: [existing], mtimes: { [existing]: 1 }, requirementsStatus: null } },
        { status: 200, body: { files: [existing, created], mtimes: { [existing]: 1, [created]: 2 }, requirementsStatus: null } },
      ],
    },
  });
  try {
    const { container, root } = setupDom();
    await renderMockedPage(root, sse);
    await act(async () => { await flush(); });
    const main = mainContent(container);

    await selectProjectAndSettle(container, name);

    assert.equal(
      main.querySelector('button[aria-label="Notes"]'), null,
      'the not-yet-created doc has no tile before its first snapshot',
    );

    // The doc is created on disk while the page stays open — no navigation, no
    // remount. The filesystem watcher's artifact_change lands, and the SAME
    // live.files both the launch tiles and the modal's doc list read from
    // (P01-T01's single-source fix) picks it up on the next snapshot.
    emitArtifactChange(sse, name);
    await act(async () => { await flush(); });

    const tile = main.querySelector('button[aria-label="Notes"]') as HTMLElement | null;
    assert.ok(tile, 'the newly-created doc has a clickable tile once its snapshot lands, with no page reload');

    act(() => { tile!.click(); });
    // The test's usePathname mock (unlike Next's real one) doesn't react to
    // history.pushState on its own; re-render to observe the URL the click's
    // own navigate() call just pushed (same convention as the deep-link test
    // above) — the user only clicked once.
    await renderMockedPage(root, sse);
    await act(async () => { await flush(); });

    assert.ok(
      !main.textContent?.includes('Document not found'),
      'the doc opens on the first click — the "Document not found" panel never appears for it',
    );
    const tablist = main.querySelector('[role="tablist"][aria-label="Artifacts"]');
    assert.ok(tablist, 'the modal opens with the filmstrip on the very first click');
    assert.ok(
      tablist!.querySelector('[data-filmstrip-cell][aria-label="View Notes"]'),
      'the newly-created doc has its own cell in the filmstrip',
    );
    assert.ok(
      tablist!.querySelector('[aria-selected="true"][aria-label="View Notes"]'),
      'the newly-created doc is the one that opened (selected tab), not a stale doc',
    );

    act(() => { root.unmount(); });
  } finally {
    stub.restore();
  }
});

// A behavioral render-harness test driving the full delete-confirm click
// (tile delete -> ConfirmApprovalDialog -> confirm) was attempted here but
// dropped: the confirm dialog is a base-ui Dialog.Popup, which does not
// render its portaled content under jsdom in this harness regardless of the
// click chain (reproduced in isolation, unrelated to this task's change).
// The `refresh()` contract this would have covered — a confirmed delete
// issuing a fresh /files fetch via live.refresh() — is covered instead by:
// (1) hooks/use-artifact-live.test.tsx pinning that refresh() always calls
// refreshSnapshot('live'), and (2) app/projects/page-live.test.tsx pinning
// that the composed onDeleted handler calls both modal.onDeleted() and
// live.refresh().
