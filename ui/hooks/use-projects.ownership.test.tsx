import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProjectStateV5 } from "@/types/state";
import type { ProjectSummary } from "@/types/components";
import { useProjects } from "./use-projects";
import { SSEContext } from "@/hooks/use-sse-context";
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

function stateFor(name: string): ProjectStateV5 {
  return {
    $schema: "orchestration-state-v5",
    project: { name, created: "2026-01-01", updated: "2026-01-01" },
    config: {
      gate_mode: "task",
      limits: { max_phases: 3, max_tasks_per_phase: 5, max_retries_per_task: 2 },
      source_control: { auto_commit: "never", auto_pr: "never" },
    },
    pipeline: { gate_mode: "task", source_control: null, current_tier: "execution", halt_reason: null },
    graph: { template_id: "std", status: "in_progress", current_node_path: null, nodes: {} },
  };
}

function deferred(): { promise: Promise<Response>; resolve: (r: Response) => void } {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Serves the project list, and routes each state request to a per-project responder. */
function seedFetch(
  projects: ProjectSummary[],
  state: (name: string) => Promise<Response>,
): () => void {
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (url: string) => {
    const target = String(url);
    if (target === "/api/projects") {
      return new Response(JSON.stringify({ projects }), { status: 200 });
    }
    const match = /^\/api\/projects\/([^/]+)\/state$/.exec(target);
    if (match) return state(decodeURIComponent(match[1]));
    return new Response("{}", { status: 404 });
  };
  return () => { global.fetch = originalFetch; };
}

/** Like seedFetch, but each project name is served a queue of responses in
 *  order — one per request — so a test can distinguish a stale request from
 *  a later one for the SAME project name. */
function seedFetchQueue(
  projects: ProjectSummary[],
  queues: Record<string, Array<{ promise: Promise<Response> }>>,
): () => void {
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (url: string) => {
    const target = String(url);
    if (target === "/api/projects") {
      return new Response(JSON.stringify({ projects }), { status: 200 });
    }
    const match = /^\/api\/projects\/([^/]+)\/state$/.exec(target);
    if (match) {
      const name = decodeURIComponent(match[1]);
      const next = queues[name]?.shift();
      if (next) return next.promise;
    }
    return new Response("{}", { status: 404 });
  };
  return () => { global.fetch = originalFetch; };
}

type ProjectsHook = ReturnType<typeof useProjects>;

let latest: ProjectsHook | null = null;

function Probe() {
  latest = useProjects(null);
  return null;
}

test("a state response resolving after a switch never lands on the newly selected project", async () => {
  const alpha = deferred();
  const beta = deferred();
  const restore = seedFetch(
    [summary("alpha"), summary("beta")],
    (name) => (name === "alpha" ? alpha.promise : beta.promise),
  );
  const root = setupDom();
  try {
    await act(async () => { root.render(<Probe />); });
    await act(async () => { latest!.selectProject("alpha"); });
    await act(async () => { latest!.selectProject("beta"); });

    // Beta answers first; alpha's request straggles in afterwards. Before the
    // ownership guard, that straggler overwrote beta's state in place.
    await act(async () => {
      beta.resolve(new Response(JSON.stringify({ state: stateFor("beta") }), { status: 200 }));
      await Promise.resolve();
      alpha.resolve(new Response(JSON.stringify({ state: stateFor("alpha") }), { status: 200 }));
    });

    assert.equal(latest!.selectedProject, "beta");
    assert.equal(latest!.projectState?.owner, "beta");
    assert.equal(latest!.projectState?.state.project.name, "beta");
    assert.equal(latest!.stateSettledFor, "beta");
  } finally {
    act(() => { root.unmount(); });
    restore();
  }
});

test("an outgoing project's state never settles the incoming one that is still in flight", async () => {
  const alpha = deferred();
  const beta = deferred();
  const restore = seedFetch(
    [summary("alpha"), summary("beta")],
    (name) => (name === "alpha" ? alpha.promise : beta.promise),
  );
  const root = setupDom();
  try {
    await act(async () => { root.render(<Probe />); });
    await act(async () => { latest!.selectProject("alpha"); });
    await act(async () => { latest!.selectProject("beta"); });

    await act(async () => {
      alpha.resolve(new Response(JSON.stringify({ state: stateFor("alpha") }), { status: 200 }));
    });

    assert.equal(latest!.projectState, null, "no state may be attributed to beta while its own fetch is pending");
    assert.equal(latest!.stateSettledFor, null, "alpha's outcome must not settle beta");

    await act(async () => {
      beta.resolve(new Response("{}", { status: 404 }));
    });

    assert.equal(latest!.projectState, null);
    assert.equal(latest!.stateSettledFor, "beta", "beta's own 404 is what settles it");
  } finally {
    act(() => { root.unmount(); });
    restore();
  }
});

test("a non-ok state response surfaces an error owned by the project it was fetched for", async () => {
  const restore = seedFetch(
    [summary("gamma")],
    async () => new Response(JSON.stringify({ error: "kaboom" }), { status: 500 }),
  );
  const root = setupDom();
  try {
    await act(async () => { root.render(<Probe />); });
    await act(async () => { latest!.selectProject("gamma"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    assert.deepEqual(latest!.error, { owner: "gamma", message: "kaboom" });
    assert.equal(latest!.stateSettledFor, "gamma");
    assert.equal(latest!.projectState, null);
  } finally {
    act(() => { root.unmount(); });
    restore();
  }
});

test("a later reselect of the same project supersedes an earlier straggling response for it", async () => {
  const first = deferred();
  const second = deferred();
  const restore = seedFetchQueue([summary("gamma")], { gamma: [first, second] });
  const root = setupDom();
  try {
    await act(async () => { root.render(<Probe />); });
    await act(async () => { latest!.selectProject("gamma"); });
    await act(async () => { latest!.selectProject("gamma"); });

    // The stale first request resolves after the second (later) one was
    // issued. Name-only equality can't tell these apart — only the
    // generation guard can reject the stale one.
    await act(async () => {
      first.resolve(new Response(JSON.stringify({ state: stateFor("gamma-stale") }), { status: 200 }));
      await Promise.resolve();
    });
    assert.equal(latest!.projectState, null, "the stale same-name response must not land");
    assert.equal(latest!.stateSettledFor, null, "the stale response must not settle state either");

    await act(async () => {
      second.resolve(new Response(JSON.stringify({ state: stateFor("gamma") }), { status: 200 }));
    });
    assert.equal(latest!.projectState?.owner, "gamma");
    assert.equal(latest!.projectState?.state.project.name, "gamma");
    assert.equal(latest!.stateSettledFor, "gamma");
  } finally {
    act(() => { root.unmount(); });
    restore();
  }
});

test("a live state_change for the selected project clears a stale owned error", async () => {
  const restore = seedFetch(
    [summary("gamma")],
    async () => new Response(JSON.stringify({ error: "kaboom" }), { status: 500 }),
  );
  const root = setupDom();
  let listener: ((e: SSEEvent) => void) | null = null;
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
    await act(async () => { latest!.selectProject("gamma"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    assert.deepEqual(latest!.error, { owner: "gamma", message: "kaboom" });

    await act(async () => {
      listener!({
        type: "state_change",
        timestamp: "2026-01-01T00:00:00Z",
        payload: {
          projectName: "gamma",
          state: stateFor("gamma"),
          projectState: { tier: "execution", state: "pending_review", label: "Pending Review" },
        },
      } as SSEEvent);
    });

    assert.equal(latest!.error, null, "the live push must clear the stale error it supersedes");
    assert.equal(latest!.projectState?.owner, "gamma");
    assert.equal(latest!.stateSettledFor, "gamma");
  } finally {
    act(() => { root.unmount(); });
    restore();
  }
});

test("a live state_change clears a malformed-state verdict the list is still holding", async () => {
  const malformed: ProjectSummary = {
    name: "gamma", tier: "not_initialized", state: "not_initialized", stateLabel: "Not Initialized",
    hasState: true, hasMalformedState: true, errorMessage: "Malformed state",
  };
  const restore = seedFetch([malformed], async () => new Response("{}", { status: 404 }));
  const root = setupDom();
  let listener: ((e: SSEEvent) => void) | null = null;
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
    assert.equal(latest!.projects[0]?.hasMalformedState, true);

    // The server only publishes a state_change once state.json parsed, so the
    // push proves the file is readable again.
    await act(async () => {
      listener!({
        type: "state_change",
        timestamp: "2026-01-01T00:00:00Z",
        payload: {
          projectName: "gamma",
          state: stateFor("gamma"),
          projectState: { tier: "execution", state: "pending_review", label: "Pending Review" },
        },
      } as SSEEvent);
    });

    const patched = latest!.projects[0];
    assert.equal(patched.hasMalformedState, false, "the stale malformed verdict must not outlive the push");
    assert.equal(patched.errorMessage, undefined);
    assert.equal(patched.stateLabel, "Pending Review");
  } finally {
    act(() => { root.unmount(); });
    restore();
  }
});

test("a live state_change for the selected project supersedes a straggling in-flight fetch", async () => {
  const slow = deferred();
  const restore = seedFetch([summary("gamma")], () => slow.promise);
  const root = setupDom();
  let listener: ((e: SSEEvent) => void) | null = null;
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
    await act(async () => { latest!.selectProject("gamma"); });

    // The live push arrives while the HTTP fetch for the same project is
    // still in flight.
    await act(async () => {
      listener!({
        type: "state_change",
        timestamp: "2026-01-01T00:00:00Z",
        payload: {
          projectName: "gamma",
          state: stateFor("gamma"),
          projectState: { tier: "execution", state: "pending_review", label: "Pending Review" },
        },
      } as SSEEvent);
    });
    assert.equal(latest!.projectState?.state.project.name, "gamma");
    assert.equal(latest!.stateSettledFor, "gamma");

    // The straggling fetch now resolves with stale data; it must not stomp
    // the live push that already superseded it.
    await act(async () => {
      slow.resolve(new Response(JSON.stringify({ state: stateFor("gamma-stale") }), { status: 200 }));
      await Promise.resolve();
    });
    assert.equal(
      latest!.projectState?.state.project.name,
      "gamma",
      "the straggling fetch must not overwrite the live push",
    );
  } finally {
    act(() => { root.unmount(); });
    restore();
  }
});
