import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { createElement, act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { OverviewPage } from "./overview-page";
import { ArtifactLiveContext, defaultArtifactLiveValue } from "@/hooks/use-artifact-live";
import type { Artifact } from "@/lib/artifact-model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const REQ: Artifact = { fileName: "DEMO-REQUIREMENTS.md", kind: "markdown", label: "Requirements", title: null, isMarkdown: true };
const PLAN: Artifact = { fileName: "DEMO-MASTER-PLAN.md", kind: "markdown", label: "Master Plan", title: null, isMarkdown: true };

function tree(
  liveOverrides: Partial<typeof defaultArtifactLiveValue>,
  projectName: string,
  onOpenArtifact: (index: number) => void,
  onDeleteArtifact: (artifact: Artifact) => void,
) {
  return createElement(
    ArtifactLiveContext.Provider,
    { value: { ...defaultArtifactLiveValue, ...liveOverrides } },
    createElement(OverviewPage, { projectName, onOpenArtifact, onDeleteArtifact }),
  );
}

function renderStatic(liveOverrides: Partial<typeof defaultArtifactLiveValue> = {}): string {
  return renderToStaticMarkup(tree(liveOverrides, "DEMO", () => {}, () => {}));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function setupDom(): Root {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: "http://localhost:3000/projects",
  });
  Object.defineProperty(globalThis, "window", { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, "document", { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  return createRoot(dom.window.document.getElementById("root") as HTMLDivElement);
}

// ─── Loading gate — the section renders nothing "real" until BOTH the ──────
// ─── artifact snapshot and the session journey have settled ───────────────

test("neither feed settled: renders the shared loading skeleton, not Documents or the journey", () => {
  // renderToStaticMarkup never runs effects, so useSessionJourney's fetch
  // never fires and `loaded` stays at its initial false — the same state the
  // real page is in for the first tick after OverviewPage mounts.
  const html = renderStatic({ artifacts: [REQ, PLAN] });
  assert.ok(html.includes('aria-label="Loading timeline"'), "the shared DAGTimelineSkeleton renders");
  assert.ok(!html.includes("Documents"), "Documents section withheld until settled");
  assert.ok(!html.includes("Session Journey"), "Session Journey section withheld until settled");
  assert.ok(!html.includes("No sessions have been recorded."), "the journey empty state must not flash before its own fetch lands");
});

test("artifact snapshot settled but the journey fetch is still in flight: still the skeleton, no premature empty state", async () => {
  const originalFetch = globalThis.fetch;
  let resolveJourney: (() => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = () =>
    new Promise((resolve) => {
      resolveJourney = () => resolve({ ok: true, json: async () => ({ sessions: [], totalActiveTimeMs: 0 }) });
    });

  const root = setupDom();
  try {
    await act(async () => {
      root.render(tree({ artifacts: [REQ, PLAN], snapshotLoaded: true }, "DEMO", () => {}, () => {}));
      await flush();
    });

    const container = document.getElementById("root")!;
    assert.ok(container.querySelector('[aria-label="Loading timeline"]'), "still the skeleton while the journey fetch is outstanding");
    assert.ok(!container.textContent?.includes("No sessions have been recorded."), "no premature empty-state flash");
    assert.ok(!container.textContent?.includes("DEMO-REQUIREMENTS.md"), "Documents also withheld — both sections settle together");

    await act(async () => {
      resolveJourney?.();
      await flush();
    });

    assert.ok(container.textContent?.includes("DEMO-REQUIREMENTS.md"), "Documents render once both feeds have settled");
    assert.ok(container.textContent?.includes("No sessions have been recorded."), "the journey's real empty state renders once its own fetch lands");
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

// ─── Loaded content — Documents section (DOM harness — the preservation set) ─

test("the Documents header carries no document count", async () => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ sessions: [], totalActiveTimeMs: 0 }) });

  const root = setupDom();
  try {
    await act(async () => {
      root.render(tree({ artifacts: [REQ, PLAN], snapshotLoaded: true }, "DEMO", () => {}, () => {}));
      await flush();
    });
    const container = document.getElementById("root")!;
    const idx = container.innerHTML.indexOf('aria-label="Documents section"');
    assert.ok(idx >= 0, "Documents section group renders");
    const groupHtml = container.innerHTML.slice(idx, idx + 400);
    assert.ok(groupHtml.includes(">Documents<"), 'the label reads exactly "Documents", no trailing count');
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test("no documents: the section still renders, with no tiles and no error", async () => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ sessions: [], totalActiveTimeMs: 0 }) });

  const root = setupDom();
  try {
    await act(async () => {
      root.render(tree({ artifacts: [], snapshotLoaded: true }, "DEMO", () => {}, () => {}));
      await flush();
    });
    const container = document.getElementById("root")!;
    assert.ok(container.textContent?.includes("Documents"), "the Documents label still renders");
    assert.ok(!container.textContent?.includes("DEMO-REQUIREMENTS.md"), "no tile markup when there are no documents");
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test("no page-level primary action — the retired launch-screen buttons never render", async () => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ sessions: [], totalActiveTimeMs: 0 }) });

  const root = setupDom();
  try {
    await act(async () => {
      root.render(tree({ artifacts: [REQ], snapshotLoaded: true }, "DEMO", () => {}, () => {}));
      await flush();
    });
    const container = document.getElementById("root")!;
    assert.ok(!/Start Planning|Start Brainstorming|Continue Brainstorming/.test(container.innerHTML));
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

// ─── Degenerate states ──────────────────────────────────────────────────────

test("no documents and no sessions together render without error", async () => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ sessions: [], totalActiveTimeMs: 0 }) });

  const root = setupDom();
  try {
    await act(async () => {
      root.render(tree({ artifacts: [], snapshotLoaded: true }, "DEMO", () => {}, () => {}));
      await flush();
    });
    const container = document.getElementById("root")!;
    assert.ok(container.textContent?.includes("Documents"));
    assert.ok(container.textContent?.includes("No sessions have been recorded."), "the journey empty state renders (P03-T02's SessionJourney)");
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test("tiles render from live.artifacts with unseen/activePulse threaded through, preserve onOpen/onDelete, and the fetched journey reaches SessionJourney", async () => {
  const originalFetch = globalThis.fetch;
  const session = {
    sessionId: "s1",
    name: "Execute DEMO",
    harness: "claude",
    cwd: "/abs/DEMO",
    cwdLabel: "DEMO",
    createdAt: "2026-08-30T00:00:00Z",
    lastSeenAt: "2026-08-30T00:10:00Z",
    activeTimeMs: 5 * 60_000,
    activity: [{ type: "execution", description: "Resuming execution.", at: "2026-08-30T00:10:00Z" }],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ sessions: [session], totalActiveTimeMs: session.activeTimeMs }) });

  const opened: number[] = [];
  const deleted: Artifact[] = [];
  const root = setupDom();
  try {
    await act(async () => {
      root.render(tree(
        { artifacts: [REQ, PLAN], unseen: new Set([PLAN.fileName]), activePulse: new Set([REQ.fileName]), snapshotLoaded: true },
        "DEMO",
        (i) => opened.push(i),
        (a) => deleted.push(a),
      ));
      await flush();
    });

    const container = document.getElementById("root")!;
    assert.ok(container.textContent?.includes("DEMO-REQUIREMENTS.md"), "Requirements tile renders");
    assert.ok(container.textContent?.includes("DEMO-MASTER-PLAN.md"), "Master Plan tile renders");

    assert.ok(container.querySelector('[aria-label="Unseen change"]'), "the unseen badge reaches the marked tile");

    const frames = container.querySelectorAll(".live-pulse-frame");
    assert.equal(frames.length, 1, "exactly the active-write-marked tile carries the pulse frame");

    const openRequirements = Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Requirements")!;
    assert.ok(openRequirements, "the Requirements tile's open control renders");
    await act(async () => { openRequirements.click(); });
    assert.deepEqual(opened, [0], "onOpenArtifact fires with the tile's index into live.artifacts");

    const deleteButtons = Array.from(container.querySelectorAll('button[aria-label="Delete artifact"]'));
    assert.equal(deleteButtons.length, 2);
    await act(async () => { (deleteButtons[1] as HTMLElement).click(); });
    assert.deepEqual(deleted, [PLAN], "onDeleteArtifact fires with the artifact belonging to the clicked tile");

    assert.ok(container.textContent?.includes("Execute DEMO"), "the fetched session reaches SessionJourney and renders its card");
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});
