/**
 * Behavioral coverage for the project_added / project_removed lifecycle path
 * in use-projects.ts, driven through the SSEContext provider seam (no real
 * filesystem, no real EventSource) — the behavioral counterpart to
 * use-projects.shared-connection.test.ts, which only asserts on source text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useProjects } from "./use-projects";
import { SSEContext } from "@/hooks/use-sse-context";
import type { ProjectSummary } from "@/types/components";
import type { SSEEvent } from "@/types/events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function setupDom(): Root {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: "http://localhost:3000/projects",
  });
  Object.defineProperty(globalThis, "window", { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, "document", { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, writable: true, configurable: true });
  const container = dom.window.document.getElementById("root") as HTMLDivElement;
  return createRoot(container);
}

function summary(name: string): ProjectSummary {
  return {
    name, tier: "execution", state: "pending_review", stateLabel: "Pending Review",
    hasState: true, hasMalformedState: false, schemaVersion: "v5",
  };
}

/** Serves /api/projects from a mutable list (so a test can simulate the
 *  server-side list diverging from what the client filtered optimistically),
 *  and /api/projects/{name}/state with a trivial 200 for any name. */
function seedFetch(getProjects: () => ProjectSummary[]): () => void {
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (url: string) => {
    const target = String(url);
    if (target === "/api/projects") {
      return new Response(JSON.stringify({ projects: getProjects() }), { status: 200 });
    }
    const match = /^\/api\/projects\/([^/]+)\/state$/.exec(target);
    if (match) {
      return new Response(JSON.stringify({ state: { fetchedFor: decodeURIComponent(match[1]) } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  return () => { global.fetch = originalFetch; };
}

type ProjectsHook = ReturnType<typeof useProjects>;

function deferred(): { promise: Promise<Response>; resolve: (r: Response) => void } {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}

test("a project_added event refetches the authoritative list and the new project appears", async () => {
  const serverProjects: ProjectSummary[] = [summary("alpha")];
  const restore = seedFetch(() => serverProjects);
  const root = setupDom();
  const latest: { current: ProjectsHook | null } = { current: null };
  let listener: ((e: SSEEvent) => void) | null = null;

  function Probe() {
    latest.current = useProjects(null);
    return null;
  }
  const sseValue = {
    sseStatus: "connected" as const,
    reconnect: () => {},
    subscribe: (l: (e: SSEEvent) => void) => { listener = l; return () => { listener = null; }; },
  };

  try {
    await act(async () => {
      root.render(
        <SSEContext.Provider value={sseValue}>
          <Probe />
        </SSEContext.Provider>,
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    assert.deepEqual(latest.current!.projects.map((p) => p.name), ["alpha"]);
    assert.ok(listener, "useProjects must subscribe to the shared SSE provider");

    // The server has since gained "beta"; the event just tells the client to look again.
    serverProjects.push(summary("beta"));

    await act(async () => {
      listener!({ type: "project_added", timestamp: "2026-01-01T00:00:00Z", payload: { projectName: "beta" } });
    });
    // Let the authoritative refetch settle before asserting.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    assert.deepEqual(
      latest.current!.projects.map((p) => p.name).sort(),
      ["alpha", "beta"],
      "the newly added project must appear after the refetch settles",
    );
  } finally {
    act(() => { root.unmount(); });
    restore();
  }
});

test("a project_removed event reconciles against the authoritative list, not just the optimistic filter", async () => {
  // Three projects, but the server has already coalesced away "gamma" too (a
  // sibling lifecycle event the coalesce window dropped). Asserting right
  // after the event — before the refetch resolves — would see only "beta"
  // filtered out (the optimistic step) and "gamma" still present, which would
  // pass a same-named assertion for the wrong reason.
  const serverProjects: ProjectSummary[] = [summary("alpha")];
  const originalFetch = global.fetch;
  const root = setupDom();
  const latest: { current: ProjectsHook | null } = { current: null };
  let listener: ((e: SSEEvent) => void) | null = null;

  function Probe() {
    latest.current = useProjects(null);
    return null;
  }
  const sseValue = {
    sseStatus: "connected" as const,
    reconnect: () => {},
    subscribe: (l: (e: SSEEvent) => void) => { listener = l; return () => { listener = null; }; },
  };

  try {
    const initialProjects: ProjectSummary[] = [summary("alpha"), summary("beta"), summary("gamma")];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = async (url: string) => {
      const target = String(url);
      if (target === "/api/projects") {
        return new Response(JSON.stringify({ projects: initialProjects }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };

    await act(async () => {
      root.render(
        <SSEContext.Provider value={sseValue}>
          <Probe />
        </SSEContext.Provider>,
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    assert.deepEqual(latest.current!.projects.map((p) => p.name).sort(), ["alpha", "beta", "gamma"]);

    // Hold the post-event /api/projects response open so the optimistic
    // intermediate state can actually be observed before the authoritative
    // refetch is allowed to land.
    let resolveList!: (r: Response) => void;
    const heldList = new Promise<Response>((r) => { resolveList = r; });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = async (url: string) => {
      const target = String(url);
      if (target === "/api/projects") return heldList;
      return new Response("{}", { status: 404 });
    };

    act(() => {
      listener!({ type: "project_removed", timestamp: "2026-01-01T00:00:00Z", payload: { projectName: "beta" } });
    });

    assert.deepEqual(
      latest.current!.projects.map((p) => p.name).sort(),
      ["alpha", "gamma"],
      "before the refetch resolves, only the optimistic filter has run",
    );

    // The server's authoritative list has ALSO dropped "gamma" — a sibling
    // lifecycle event the coalesce window dropped, which the optimistic
    // filter (which only ever removes "beta") cannot see for itself.
    await act(async () => {
      resolveList(new Response(JSON.stringify({ projects: serverProjects }), { status: 200 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.deepEqual(
      latest.current!.projects.map((p) => p.name).sort(),
      ["alpha"],
      "once the refetch settles, the authoritative list wins — recovering the coalesced-away gamma removal too",
    );
  } finally {
    act(() => { root.unmount(); });
    global.fetch = originalFetch;
  }
});

test("a project_added event for an unrelated project that reveals the selected project has gone malformed clears its stale owned state", async () => {
  // alpha starts out valid and gets successfully selected. Its state.json is
  // then corrupted by some external process — nothing here refetches alpha's
  // own state, but an unrelated project_added event for "beta" still
  // refetches the authoritative list, which is the only place
  // hasMalformedState is refreshed from. Without invalidating the stale
  // owned state on that discovery, selectProjectView's malformed-recovered-
  // via-retry carve-out would let alpha's now-untrustworthy cached state
  // coincidentally keep rendering 'plan'.
  const serverProjects: ProjectSummary[] = [summary("alpha")];
  const restore = seedFetch(() => serverProjects);
  const root = setupDom();
  const latest: { current: ProjectsHook | null } = { current: null };
  let listener: ((e: SSEEvent) => void) | null = null;

  function Probe() {
    latest.current = useProjects(null);
    return null;
  }
  const sseValue = {
    sseStatus: "connected" as const,
    reconnect: () => {},
    subscribe: (l: (e: SSEEvent) => void) => { listener = l; return () => { listener = null; }; },
  };

  try {
    await act(async () => {
      root.render(
        <SSEContext.Provider value={sseValue}>
          <Probe />
        </SSEContext.Provider>,
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { latest.current!.selectProject("alpha"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    assert.ok(latest.current!.projectState, "alpha's state should be populated before it goes malformed");
    assert.equal(latest.current!.stateSettledFor, "alpha");

    // alpha's own state.json is now malformed on disk; the server-side
    // discovery will report it on the next list fetch. Nothing has asked for
    // alpha's own state again, so the client's stale copy is all it has.
    serverProjects.splice(0, serverProjects.length, { ...summary("alpha"), hasMalformedState: true });

    await act(async () => {
      listener!({ type: "project_added", timestamp: "2026-01-01T00:00:00Z", payload: { projectName: "beta" } });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    assert.equal(
      latest.current!.projectState,
      null,
      "stale owned state for a project just discovered malformed must not survive",
    );
    assert.equal(
      latest.current!.stateSettledFor,
      null,
      "the settled marker must be cleared too, so the view can't read it as a fresh recovery",
    );
  } finally {
    act(() => { root.unmount(); });
    restore();
  }
});

test("a stale list response cannot clobber a fresher retry that already settled good state", async () => {
  // alpha is selected and settled with good state. An unrelated lifecycle
  // event (added below as "beta") kicks off a list refetch that will
  // eventually report alpha as malformed — but before that request resolves,
  // a Retry re-fetches alpha's own state directly and settles it again. The
  // list response, once it does land, reflects how alpha looked BEFORE the
  // retry and must not be allowed to wipe out the retry's fresher result.
  const heldList = deferred();
  let listCall = 0;
  const originalFetch = global.fetch;
  const root = setupDom();
  const latest: { current: ProjectsHook | null } = { current: null };
  let listener: ((e: SSEEvent) => void) | null = null;

  function Probe() {
    latest.current = useProjects(null);
    return null;
  }
  const sseValue = {
    sseStatus: "connected" as const,
    reconnect: () => {},
    subscribe: (l: (e: SSEEvent) => void) => { listener = l; return () => { listener = null; }; },
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = async (url: string) => {
      const target = String(url);
      if (target === "/api/projects") {
        listCall++;
        if (listCall === 1) {
          return new Response(JSON.stringify({ projects: [summary("alpha")] }), { status: 200 });
        }
        return heldList.promise;
      }
      if (target === "/api/projects/alpha/state") {
        return new Response(JSON.stringify({ state: { fetchedFor: "alpha" } }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };

    await act(async () => {
      root.render(
        <SSEContext.Provider value={sseValue}>
          <Probe />
        </SSEContext.Provider>,
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { latest.current!.selectProject("alpha"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    assert.ok(latest.current!.projectState, "alpha's state should settle from the initial select");

    // The unrelated project_added event for "beta" issues the second,
    // held-open /api/projects request.
    act(() => {
      listener!({ type: "project_added", timestamp: "2026-01-01T00:00:00Z", payload: { projectName: "beta" } });
    });

    // Before that list request resolves, a Retry re-fetches alpha directly —
    // the freshest truth — and it settles.
    await act(async () => { latest.current!.selectProject("alpha"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    assert.ok(latest.current!.projectState, "the retry's own fetch must settle alpha again");

    // The stale list request — issued before the retry — now resolves,
    // reporting alpha as malformed (how it looked before the retry).
    await act(async () => {
      heldList.resolve(new Response(
        JSON.stringify({ projects: [{ ...summary("alpha"), hasMalformedState: true }] }),
        { status: 200 },
      ));
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.ok(latest.current!.projectState, "the retry's fresher state must survive the stale list response");
    assert.equal(
      latest.current!.stateSettledFor,
      "alpha",
      "the retry's settle marker must survive the stale list response",
    );
  } finally {
    act(() => { root.unmount(); });
    global.fetch = originalFetch;
  }
});

test("a project_removed event for the selected project clears its selection and state", async () => {
  const serverProjects: ProjectSummary[] = [summary("alpha"), summary("beta")];
  const restore = seedFetch(() => serverProjects);
  const root = setupDom();
  const latest: { current: ProjectsHook | null } = { current: null };
  let listener: ((e: SSEEvent) => void) | null = null;

  function Probe() {
    latest.current = useProjects(null);
    return null;
  }
  const sseValue = {
    sseStatus: "connected" as const,
    reconnect: () => {},
    subscribe: (l: (e: SSEEvent) => void) => { listener = l; return () => { listener = null; }; },
  };

  try {
    await act(async () => {
      root.render(
        <SSEContext.Provider value={sseValue}>
          <Probe />
        </SSEContext.Provider>,
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { latest.current!.selectProject("alpha"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    assert.equal(latest.current!.selectedProject, "alpha");
    assert.ok(latest.current!.projectState, "the selected project's state should be populated before removal");

    // The server has removed "alpha" out from under the selection.
    serverProjects.splice(0, serverProjects.length, summary("beta"));

    await act(async () => {
      listener!({ type: "project_removed", timestamp: "2026-01-01T00:00:00Z", payload: { projectName: "alpha" } });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    assert.equal(latest.current!.selectedProject, null, "removing the selected project must clear the selection");
    assert.equal(latest.current!.projectState, null, "removing the selected project must clear its state");
    assert.deepEqual(
      latest.current!.projects.map((p) => p.name),
      ["beta"],
      "the authoritative list must no longer include the removed project",
    );
  } finally {
    act(() => { root.unmount(); });
    restore();
  }
});
