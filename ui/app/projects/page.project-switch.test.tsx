/**
 * Rendering tests for projects/page — the first test in this repo to actually
 * mount <ProjectsPage>. Every sibling in this directory (page.test.tsx,
 * page-live.test.tsx, page.planning-wiring.test.tsx, page.modal-wiring.test.tsx,
 * page.brainstorming-wiring.test.tsx) asserts on source text instead; this file
 * establishes the render harness and uses it to pin two things a source-text
 * assertion can't reach:
 *   - the file list, modal markdown body, and modal frontmatter are discarded
 *     when they resolve for a project the user has since switched away from;
 *   - a state fetch that fails for the selected project renders the error+retry
 *     view rather than hanging on the skeleton, and retry re-runs a real fetch.
 *
 * Full-page render path (not the ProjectsPageContent-with-props fallback the
 * handoff allows): mounting <ProjectsPage> itself proved workable once
 * `window.matchMedia` was stubbed and the ArtifactLiveProvider's own `/files`
 * snapshot fetch was answered for every selected project.
 */
import { test, before } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ProjectsPage from './[[...slug]]/page';
import type { ProjectSummary } from '@/types/components';
import type { ProjectStateV5 } from '@/types/state';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// A real value reference (not just `typeof ProjectsPage` in a type position)
// so esbuild's unused-import elision can't drop this import — its side effect
// of populating require.cache (page.tsx, transitively next/navigation) is
// exactly what loadMockedProjectsPage below depends on below.
assert.strictEqual(ProjectsPage.name, 'ProjectsPage', 'default export should be named ProjectsPage');

// ─── next/navigation mock ──────────────────────────────────────────────────

/**
 * tsx compiles imports to CJS require(), so require.cache is accessible — the
 * same technique app-header.test.tsx uses for usePathname. Both page.tsx AND
 * the useProjects hook it calls read next/navigation directly, so both must be
 * deleted and re-required against the swapped exports: deleting only the page
 * module would leave useProjects's already-cached module bound to the real
 * (unmounted-router) next/navigation, which throws outside a real Next router.
 */
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
  // Several Radix/base-ui internals (sidebar collapsible, tooltip) check
  // `instanceof HTMLElement`/`Node` against the GLOBAL constructors rather than
  // `window.HTMLElement` — jsdom only installs its own on `dom.window`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Node = dom.window.Node;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Element = dom.window.Element;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MouseEvent = dom.window.MouseEvent;
  Object.defineProperty(dom.window, 'innerWidth', { value: 1280, configurable: true });
  // jsdom implements innerWidth but not matchMedia; SidebarProvider's
  // use-mobile hook needs a stub to avoid throwing on mount.
  dom.window.matchMedia = (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  const container = dom.window.document.getElementById('root') as HTMLDivElement;
  const root = createRoot(container);
  return { container, root };
}

function mainContent(container: HTMLElement): HTMLElement {
  const el = container.querySelector('#main-content');
  assert.ok(el, 'main-content region not found');
  return el as HTMLElement;
}

// ─── State/summary fixtures ─────────────────────────────────────────────────

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
    // Empty nodes + a null current_node_path keep the right-hand DAG-state
    // card and its ResizeObserver-driven measuring out of the render entirely
    // (shouldShowStateCard is false) — the render harness only needs the
    // <DAGTimeline role="listbox"> shell to prove the plan view is on screen.
    graph: { template_id: 'v5-template', status: 'in_progress', current_node_path: null, nodes: {} },
  };
}

function plannedSummary(name: string): ProjectSummary {
  return { name, tier: 'execution', hasState: true, hasMalformedState: false, schemaVersion: 'v5' };
}

function unplannedSummary(name: string): ProjectSummary {
  return { name, tier: 'not_initialized', hasState: false, hasMalformedState: false };
}

// ─── Fetch stub ─────────────────────────────────────────────────────────────

interface FilesBody {
  files: string[];
  mtimes: Record<string, number>;
  requirementsStatus: string | null;
}

type StateSpec = { status: number; body: unknown } | 'hold';
type FilesSpec = FilesBody | 'hold';

interface FetchFixtures {
  projects: ProjectSummary[];
  /** Per-project response queue for GET .../state, consumed call-by-call
   *  (the last entry repeats). 'hold' never resolves until releaseState. */
  state?: Record<string, StateSpec[]>;
  /** Per-project response for GET .../files. 'hold' never resolves until
   *  releaseFiles — both the page's own fetch and ArtifactLiveProvider's
   *  baseline snapshot hit this same endpoint and are held together. */
  files?: Record<string, FilesSpec>;
}

function installFetchStub(fixtures: FetchFixtures) {
  const original = global.fetch;
  const stateCallIndex = new Map<string, number>();
  const heldState: Array<{ name: string; resolve: (r: Response) => void }> = [];
  const heldFiles: Array<{ name: string; resolve: (r: Response) => void }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (input: string) => {
    const url = String(input);
    if (url.endsWith('/api/projects')) {
      return new Response(JSON.stringify({ projects: fixtures.projects }), { status: 200 });
    }
    if (url.includes('/api/registry')) {
      return new Response('{}', { status: 404 });
    }
    let m = url.match(/\/api\/projects\/([^/]+)\/state(?:\?.*)?$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const queue = fixtures.state?.[name] ?? [];
      const idx = stateCallIndex.get(name) ?? 0;
      stateCallIndex.set(name, idx + 1);
      const spec: StateSpec = queue[Math.min(idx, queue.length - 1)] ?? { status: 404, body: {} };
      if (spec === 'hold') {
        return new Promise<Response>((resolve) => { heldState.push({ name, resolve }); });
      }
      return new Response(JSON.stringify(spec.body), { status: spec.status });
    }
    m = url.match(/\/api\/projects\/([^/]+)\/files(?:\?.*)?$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const spec = fixtures.files?.[name];
      if (spec === 'hold') {
        return new Promise<Response>((resolve) => { heldFiles.push({ name, resolve }); });
      }
      const body: FilesBody = spec ?? { files: [], mtimes: {}, requirementsStatus: null };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  return {
    restore: () => { global.fetch = original; },
    releaseState: (name: string, spec: { status: number; body: unknown }) => {
      const idx = heldState.findIndex((h) => h.name === name);
      assert.ok(idx !== -1, `no held state request for ${name}`);
      const [h] = heldState.splice(idx, 1);
      h.resolve(new Response(JSON.stringify(spec.body), { status: spec.status }));
    },
    releaseFiles: (name: string, body: FilesBody) => {
      const matches = heldFiles.filter((h) => h.name === name);
      assert.ok(matches.length > 0, `no held files request for ${name}`);
      for (const h of matches) {
        heldFiles.splice(heldFiles.indexOf(h), 1);
        h.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }
    },
  };
}

// ─── Interaction helpers ────────────────────────────────────────────────────

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * The state placeholder has a minimum-visible floor (PLACEHOLDER_FLOOR_MS =
 * 300ms in page.tsx) so a fast fetch never flashes the skeleton for a couple
 * of frames. Reaching the 'plan' or 'launch' view in a test therefore needs a
 * real wait past that floor, not just a microtask flush.
 */
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

function hasPipelineTimeline(el: HTMLElement): boolean {
  return el.querySelector('[role="listbox"][aria-label="Pipeline timeline"]') !== null;
}

function launchHeadingText(el: HTMLElement): string | null {
  const h1 = el.querySelector('h1');
  return h1 ? h1.textContent : null;
}

function hasStateErrorAlert(el: HTMLElement): boolean {
  return el.querySelector('[data-slot="alert"]') !== null;
}

/**
 * The SSE status banner also renders a "Retry" reconnect button (always
 * present here since the test never mounts a real SSEProvider, so sseStatus
 * stays "disconnected"), so the state-error retry control must be scoped to
 * the alert itself rather than searched for across the whole view.
 */
function findStateRetryButton(el: HTMLElement): HTMLButtonElement | undefined {
  const alert = el.querySelector('[data-slot="alert"]');
  if (!alert) return undefined;
  return findButtonByText(alert as HTMLElement, 'Retry');
}

function findButtonByText(el: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("planned -> unplanned renders the launch screen with no trace of the first project's plan", async () => {
  const planned = plannedSummary('switch-planned-a');
  const unplanned = unplannedSummary('switch-unplanned-a');
  const stub = installFetchStub({
    projects: [planned, unplanned],
    state: { [planned.name]: [{ status: 200, body: { state: buildV5State(planned.name) } }] },
    files: { [planned.name]: { files: [], mtimes: {}, requirementsStatus: null } },
  });
  try {
    const { container, root } = setupDom();
    await act(async () => { root.render(<MockedProjectsPage />); });
    await act(async () => { await flush(); });
    const main = mainContent(container);

    await selectProjectAndSettle(container, planned.name);
    assert.ok(hasPipelineTimeline(main), 'the planned project should render its plan');

    await selectProjectAndSettle(container, unplanned.name);
    assert.strictEqual(launchHeadingText(main), unplanned.name, 'the launch screen should show the unplanned project');
    assert.ok(!hasPipelineTimeline(main), "the outgoing project's plan must not remain on screen");
    assert.ok(
      !main.textContent?.includes(planned.name),
      "no trace of the outgoing project's name should remain once the launch screen is on screen",
    );

    act(() => { root.unmount(); });
  } finally {
    stub.restore();
  }
});

test('unplanned -> planned renders the plan with no trace of the launch screen', async () => {
  const unplanned = unplannedSummary('switch-unplanned-b');
  const planned = plannedSummary('switch-planned-b');
  const stub = installFetchStub({
    projects: [unplanned, planned],
    state: { [planned.name]: [{ status: 200, body: { state: buildV5State(planned.name) } }] },
    files: { [planned.name]: { files: [], mtimes: {}, requirementsStatus: null } },
  });
  try {
    const { container, root } = setupDom();
    await act(async () => { root.render(<MockedProjectsPage />); });
    await act(async () => { await flush(); });
    const main = mainContent(container);

    await selectProjectAndSettle(container, unplanned.name);
    assert.strictEqual(launchHeadingText(main), unplanned.name, 'the unplanned project should show the launch screen');

    await selectProjectAndSettle(container, planned.name);
    assert.ok(hasPipelineTimeline(main), 'the planned project should render its plan');
    assert.strictEqual(launchHeadingText(main), null, 'the launch screen must not remain once the plan is on screen');
    assert.ok(
      !main.textContent?.includes(unplanned.name),
      'no trace of the outgoing unplanned project should remain',
    );

    act(() => { root.unmount(); });
  } finally {
    stub.restore();
  }
});

test('a state response that resolves after the switch changes nothing', async () => {
  const a = plannedSummary('late-state-a');
  const b = plannedSummary('late-state-b');
  const stub = installFetchStub({
    projects: [a, b],
    state: {
      [a.name]: ['hold'],
      [b.name]: [{ status: 200, body: { state: buildV5State(b.name) } }],
    },
    files: {
      [a.name]: { files: [], mtimes: {}, requirementsStatus: null },
      [b.name]: { files: [], mtimes: {}, requirementsStatus: null },
    },
  });
  try {
    const { container, root } = setupDom();
    await act(async () => { root.render(<MockedProjectsPage />); });
    await act(async () => { await flush(); });
    const main = mainContent(container);

    clickProjectRow(container, a.name);
    await act(async () => { await flush(); });
    assert.ok(!hasPipelineTimeline(main), "a's state fetch is held — it must not have a plan yet");

    await selectProjectAndSettle(container, b.name);
    assert.ok(hasPipelineTimeline(main), "b's plan should render");
    assert.ok(main.textContent?.includes(b.name), 'the header should read b');

    stub.releaseState(a.name, { status: 200, body: { state: buildV5State(a.name) } });
    await act(async () => { await flush(); });

    assert.ok(hasPipelineTimeline(main), "b's plan must remain rendered after a's late resolve");
    assert.ok(main.textContent?.includes(b.name), 'the header must still read b after a resolves late');
    assert.ok(!main.textContent?.includes(a.name), "a's late state must never surface");

    act(() => { root.unmount(); });
  } finally {
    stub.restore();
  }
});

test("switching away before b's own /files settles must not resolve a stale (a-owned) document path under b", async () => {
  // PlanningDocsList/LaunchScreen render `live.artifacts` (ArtifactLiveProvider's
  // own, already-owner-guarded state), not the page's `fileList`/`modalDocs` — so
  // this test drives the one thing modalDocs alone controls: whether a deep-linked
  // doc path resolves to the real ArtifactViewerModal or the "not found" state.
  // Deep-linking is done via a raw pushState (not a sidebar click) so the doc
  // segment survives — selecting a project via the sidebar always navigates to
  // that project's bare URL, dropping any doc segment.
  const a = plannedSummary('late-files-a');
  const b = plannedSummary('late-files-b');
  const aDoc = `${a.name}-DOC.md`;
  const stub = installFetchStub({
    projects: [a, b],
    state: {
      [a.name]: [{ status: 200, body: { state: buildV5State(a.name) } }],
      [b.name]: [{ status: 200, body: { state: buildV5State(b.name) } }],
    },
    files: {
      [a.name]: { files: [aDoc], mtimes: { [aDoc]: 1 }, requirementsStatus: null },
      [b.name]: 'hold',
    },
  });
  try {
    const { container, root } = setupDom();
    await act(async () => { root.render(<MockedProjectsPage />); });
    await act(async () => { await flush(); });
    const main = mainContent(container);

    await selectProjectAndSettle(container, a.name);
    assert.ok(main.textContent?.includes(a.name), "a's header should be up once its state settles");

    // b is now selected; b's own /files fetch is held, so the page's fileList
    // is either still a's stale array (pre-fix) or already reset to [] (fixed).
    await selectProjectAndSettle(container, b.name);

    act(() => {
      window.history.pushState(null, '', `/projects/${encodeURIComponent(b.name)}/docs/${encodeURIComponent(aDoc)}`);
      root.render(<MockedProjectsPage />);
    });
    await act(async () => { await flush(); });

    assert.ok(
      !main.querySelector('[role="tablist"][aria-label="Artifacts"]'),
      "a stale, a-owned filename must not resolve to a real document under b before b's own /files settles",
    );

    stub.releaseFiles(b.name, { files: [], mtimes: {}, requirementsStatus: null });
    await act(async () => { await flush(); });

    assert.ok(
      !main.querySelector('[role="tablist"][aria-label="Artifacts"]'),
      "a's filename must still not resolve once b settles with no matching doc of its own",
    );
    assert.ok(
      main.querySelector('[role="alert"]'),
      'b settling with no matching doc should surface the not-found state',
    );

    act(() => { root.unmount(); });
  } finally {
    stub.restore();
  }
});

test('a failed state fetch for the selected project renders the error with a working retry, distinct from an unplanned project', async () => {
  const flaky = plannedSummary('flaky-project');
  const unplanned = unplannedSummary('flaky-unplanned-sibling');
  const stub = installFetchStub({
    projects: [flaky, unplanned],
    state: {
      [flaky.name]: [
        { status: 500, body: { error: 'boom' } },
        { status: 200, body: { state: buildV5State(flaky.name) } },
      ],
    },
    files: { [flaky.name]: { files: [], mtimes: {}, requirementsStatus: null } },
  });
  try {
    const { container, root } = setupDom();
    await act(async () => { root.render(<MockedProjectsPage />); });
    await act(async () => { await flush(); });
    const main = mainContent(container);

    clickProjectRow(container, flaky.name);
    await act(async () => { await flush(); });

    assert.ok(hasStateErrorAlert(main), 'a failed state fetch should render the error alert rather than the skeleton');
    assert.ok(!hasPipelineTimeline(main), 'no plan should render for a failed load');
    assert.strictEqual(launchHeadingText(main), null, 'a failed load must not resemble the launch screen');

    const retryButton = findStateRetryButton(main);
    assert.ok(retryButton, 'a retry control must be present');
    act(() => { retryButton!.click(); });
    await act(async () => { await flush(); });
    await waitPastPlaceholderFloor();

    assert.ok(hasPipelineTimeline(main), 'activating retry should re-run the fetch and render the plan on success');
    assert.ok(!hasStateErrorAlert(main), 'the error alert should be gone once the retry succeeds');

    await selectProjectAndSettle(container, unplanned.name);
    assert.ok(!hasStateErrorAlert(main), 'an unplanned project renders no error alert');
    assert.strictEqual(launchHeadingText(main), unplanned.name, 'an unplanned project renders the launch screen');

    act(() => { root.unmount(); });
  } finally {
    stub.restore();
  }
});
