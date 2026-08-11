/**
 * Behavioral coverage for the reconnect resync added to use-projects.ts: a
 * `connected` event must refetch the project list unconditionally, and —
 * when a project is selected — that project's state too, so a tab that rode
 * out an outage doesn't show a stale list or a stale plan once the stream
 * returns.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useProjects as originalUseProjects } from "./use-projects";
import { SSEContext } from "@/hooks/use-sse-context";
import type { SSEEvent } from "@/types/events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// A real reference so esbuild can't elide the import whose side effect
// (populating require.cache for use-projects.ts / next/navigation) the mock
// below depends on.
assert.strictEqual(typeof originalUseProjects, "function");

/**
 * use-projects.ts reads usePathname from next/navigation directly, which
 * throws outside a real Next router. Same require.cache swap app-header.test.tsx
 * and page.project-switch.test.tsx use for the same reason.
 */
function loadMockedUseProjects(): typeof originalUseProjects {
  const req = require as NodeRequire & { cache: Record<string, { exports: unknown } | undefined> };
  const navPath = req.resolve("next/navigation");
  const useProjectsPath = req.resolve("./use-projects");
  const origNavExports = req.cache[navPath]?.exports;
  assert.ok(origNavExports, "next/navigation must be in require cache before mock");

  const mock = Object.create(origNavExports as object) as Record<string, unknown>;
  Object.defineProperty(mock, "usePathname", {
    value: () => window.location.pathname,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  req.cache[navPath]!.exports = mock;
  delete req.cache[useProjectsPath];
  try {
    const fresh = req("./use-projects") as { useProjects: typeof originalUseProjects };
    return fresh.useProjects;
  } finally {
    req.cache[navPath]!.exports = origNavExports;
  }
}

let useProjects: typeof originalUseProjects;
before(() => { useProjects = loadMockedUseProjects(); });

function setupDom(): { container: HTMLDivElement; root: Root } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: "http://localhost:3000/projects/demo",
  });
  Object.defineProperty(globalThis, "window", { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, "document", { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
  const container = dom.window.document.getElementById("root") as HTMLDivElement;
  const root = createRoot(container);
  return { container, root };
}

function seedFetch(): {
  stateFetchCount: () => number;
  listFetchCount: () => number;
  restore: () => void;
} {
  const originalFetch = global.fetch;
  let stateFetchCount = 0;
  let listFetchCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (url: string) => {
    const s = String(url);
    if (s.endsWith("/api/projects")) {
      listFetchCount++;
      return new Response(JSON.stringify({ projects: [{ name: "demo" }] }), { status: 200 });
    }
    if (s.includes("/api/projects/") && s.endsWith("/state")) {
      stateFetchCount++;
      return new Response(JSON.stringify({ state: { fetchedAt: stateFetchCount } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  return {
    stateFetchCount: () => stateFetchCount,
    listFetchCount: () => listFetchCount,
    restore: () => { global.fetch = originalFetch; },
  };
}

test("a connected event with a project selected refetches both the project list and that project's state", async () => {
  const { stateFetchCount, listFetchCount, restore } = seedFetch();
  try {
    const { root } = setupDom();

    let capturedListener: ((e: SSEEvent) => void) | null = null;
    const sseValue = {
      sseStatus: "connected" as const,
      reconnect: () => {},
      subscribe: (listener: (e: SSEEvent) => void) => {
        capturedListener = listener;
        return () => { capturedListener = null; };
      },
    };

    function Probe() {
      useProjects("demo");
      return null;
    }

    await act(async () => {
      root.render(
        <SSEContext.Provider value={sseValue}>
          <Probe />
        </SSEContext.Provider>,
      );
    });
    // Let the mount effect's project-list and initial state fetch resolve.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    const stateCountAfterMount = stateFetchCount();
    const listCountAfterMount = listFetchCount();
    assert.ok(stateCountAfterMount >= 1, "the initial mount fetches the selected project's state");
    assert.ok(listCountAfterMount >= 1, "the initial mount fetches the project list");
    assert.ok(capturedListener, "useProjects must subscribe to the shared SSE provider");

    await act(async () => {
      capturedListener!({ type: "connected", payload: { projects: ["demo"] } } as SSEEvent);
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    assert.ok(
      stateFetchCount() > stateCountAfterMount,
      "a connected event with a project selected must refetch that project's state",
    );
    assert.ok(
      listFetchCount() > listCountAfterMount,
      "a connected event must unconditionally refetch the project list",
    );

    act(() => { root.unmount(); });
  } finally {
    restore();
  }
});
