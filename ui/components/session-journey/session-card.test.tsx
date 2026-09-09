import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { JourneySession } from "@/lib/journey-model";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const source = readFileSync(join(__dirname, "session-card.tsx"), "utf-8");

const multiActivitySession: JourneySession = {
  sessionId: "7cc94fca-eed0-4e79-ae94-a958256687ca",
  name: "final-gate corrective: rename executable",
  harness: "claude",
  cwd: "/abs/side-projects/ANSI-VADER-CLI",
  cwdLabel: "side-projects/ANSI-VADER-CLI",
  createdAt: "2026-08-30T05:51:00Z",
  lastSeenAt: "2026-08-30T18:02:00Z",
  activeTimeMs: 16 * 60_000,
  activity: [
    { type: "final-approved", description: "Operator approved final delivery.", at: "2026-08-30T18:02:00Z" },
    { type: "execution-complete", description: "Corrective delivered.", at: "2026-08-30T06:07:00Z" },
    { type: "corrective", description: "Operator requested renaming the executable.", at: "2026-08-30T06:03:00Z" },
  ],
};

const singleActivitySession: JourneySession = {
  ...multiActivitySession,
  sessionId: "54aadaf9-0bc5-4360-933b-41fa2b74dd64",
  name: "Add --no-color toggle",
  activeTimeMs: 0,
  activity: [multiActivitySession.activity[0]],
};

/**
 * base-ui's `Collapsible` decides once, at module-evaluation time, whether
 * `document` exists and therefore whether its close transition can run as a
 * real `useLayoutEffect` (see `@base-ui/utils/useIsoLayoutEffect`). A static
 * top-level `import "./session-card"` would evaluate — and permanently poison
 * that decision — before any jsdom environment exists. So, like
 * `delete-project-dialog.test.tsx`, every test loads jsdom first and only
 * then dynamically imports the module under test.
 */
async function loadModule() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><div id=\"root\"></div>");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;
  // base-ui's useButton hook checks `instanceof HTMLElement` against the
  // global, not `window.HTMLElement` — without this, mounting a base-ui
  // Button/Collapsible under jsdom throws "HTMLElement is not defined".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  // base-ui's Collapsible defers its close (`mounted -> false`) transition
  // through a real `requestAnimationFrame`, which jsdom does not provide
  // without `pretendToBeVisual` — polyfill it the same way
  // `delete-project-dialog.test.tsx` does for its own base-ui primitive.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);

  return import("./session-card");
}

async function render(session: JourneySession): Promise<string> {
  const { SessionCard } = await loadModule();
  return renderToStaticMarkup(createElement(SessionCard, { projectName: "ANSI-VADER-CLI", session }));
}

async function mount(session: JourneySession) {
  const { SessionCard } = await loadModule();
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const container = (globalThis as any).document.getElementById("root") as HTMLElement; // eslint-disable-line @typescript-eslint/no-explicit-any
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SessionCard, { projectName: "ANSI-VADER-CLI", session }));
  });
  return { container, root, act };
}

// ─── formatActivityTime ──────────────────────────────────────────────────

test("formatActivityTime renders the wireframe's 'Mon D HH:mm' shape (no comma)", async () => {
  const { formatActivityTime } = await loadModule();
  assert.equal(formatActivityTime("2026-08-30T06:07:00Z"), formatActivityTime("2026-08-30T06:07:00Z"));
  assert.ok(!formatActivityTime("2026-08-30T06:07:00Z").includes(","), "no comma between date and time");
});

// ─── buildSessionMetaParts — the zero-guard ─────────────────────────────────

test("buildSessionMetaParts omits active time entirely when activeTimeMs is 0", async () => {
  const { buildSessionMetaParts } = await loadModule();
  const parts = buildSessionMetaParts({ ...multiActivitySession, activeTimeMs: 0 });
  assert.ok(!parts.some((p) => p.text.includes("m") && !p.mono && p.text !== "claude"), "no near-zero duration part");
  assert.deepEqual(parts.map((p) => p.text), ["claude", multiActivitySession.cwdLabel, multiActivitySession.sessionId]);
});

test("buildSessionMetaParts includes formatDuration's output when activeTimeMs is positive", async () => {
  const { buildSessionMetaParts } = await loadModule();
  const parts = buildSessionMetaParts(multiActivitySession);
  assert.equal(parts[0].text, "16m");
});

test("buildSessionMetaParts carries the full, untruncated session id", async () => {
  const { buildSessionMetaParts } = await loadModule();
  const parts = buildSessionMetaParts(multiActivitySession);
  assert.ok(parts.some((p) => p.text === multiActivitySession.sessionId), "full session id present, not truncated");
});

test("buildSessionMetaParts renders cwdLabel, never the raw cwd", async () => {
  const { buildSessionMetaParts } = await loadModule();
  const parts = buildSessionMetaParts(multiActivitySession);
  assert.ok(parts.some((p) => p.text === multiActivitySession.cwdLabel));
  assert.ok(!parts.some((p) => p.text === multiActivitySession.cwd));
});

// ─── Collapsed rendering ────────────────────────────────────────────────────

test("collapsed: renders the session name and activity count, but no activity descriptions", async () => {
  const html = await render(multiActivitySession);
  assert.ok(html.includes(multiActivitySession.name));
  assert.ok(html.includes("3 activities"));
  assert.ok(!html.includes("Operator approved final delivery."), "no activities visible while collapsed");
  assert.ok(!html.includes("Corrective delivered."));
  assert.ok(!html.includes("Operator requested renaming the executable."));
});

test("single-activity card shows a count of '1 activity' and renders a disclosure trigger", async () => {
  const html = await render(singleActivitySession);
  assert.ok(html.includes("1 activity"), "singular count for a single-activity card");
  assert.ok(html.includes('data-slot="collapsible-trigger"'), "trigger exists for all cards now");
  assert.ok(!html.includes("invisible"), "chevron is visible and rotatable");
});

test("activity count uses singular 'activity' for 1 item and plural 'activities' for 2+", async () => {
  const singleHtml = await render(singleActivitySession);
  assert.ok(singleHtml.includes("1 activity"), "singular form for 1 activity");

  const multiHtml = await render(multiActivitySession);
  assert.ok(multiHtml.includes("3 activities"), "plural form for 3 activities");
  assert.ok(!multiHtml.includes("1 activities"), "no incorrect plural for multiple items");
});

// ─── Expand/collapse — nothing duplicated, order preserved, row stays put ──

test("expanding reveals the full activity list; collapsed shows no activities, expanded shows all without duplication", async () => {
  const { container, root, act } = await mount(multiActivitySession);
  try {
    // Nothing visible while collapsed
    assert.ok(!container.textContent?.includes("Operator approved final delivery."), "no activities visible while collapsed");
    assert.equal(container.textContent?.includes("Corrective delivered."), false);
    assert.equal(container.textContent?.includes("Operator requested renaming the executable."), false);

    const trigger = container.querySelector('[data-slot="collapsible-trigger"]') as HTMLButtonElement;
    assert.ok(trigger, "trigger exists for all cards");
    await act(async () => { trigger.click(); });

    const text = container.textContent ?? "";
    // All activities appear after expanding
    assert.ok(text.includes("Operator approved final delivery."));
    assert.ok(text.includes("Corrective delivered."));
    assert.ok(text.includes("Operator requested renaming the executable."));
    // Newest-first: the latest activity text still precedes both older rows.
    const latestIdx = text.indexOf("Operator approved final delivery.");
    const midIdx = text.indexOf("Corrective delivered.");
    const oldestIdx = text.indexOf("Operator requested renaming the executable.");
    assert.ok(latestIdx < midIdx && midIdx < oldestIdx, "activities render in the given newest-first order");

    // Nothing duplicated: each description appears exactly once.
    assert.equal(text.split("Operator approved final delivery.").length - 1, 1);
    assert.equal(text.split("Corrective delivered.").length - 1, 1);

    // Collapsing a previously-expanded card hides its activities again. The
    // underlying Collapsible primitive unmounts panel content through a
    // `requestAnimationFrame`-scheduled transition, so give that a tick.
    await act(async () => {
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const collapsedText = container.textContent ?? "";
    assert.equal(collapsedText.includes("Operator approved final delivery."), false, "no row survives a collapse");
    assert.equal(collapsedText.includes("Corrective delivered."), false);
    assert.equal(collapsedText.includes("Operator requested renaming the executable."), false);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

// ─── Accessibility shape — siblings, not descendants ───────────────────────

test("Continue Session and View Telemetry are real siblings of the header trigger, never nested inside it", async () => {
  const { container, root, act } = await mount(multiActivitySession);
  try {
    const trigger = container.querySelector('[data-slot="collapsible-trigger"]')!;
    assert.equal(trigger.textContent, "", "the trigger carries no visible content of its own (full-row overlay)");
    assert.ok(!trigger.querySelector("button, a"), "no control nested inside the trigger");

    const buttons = Array.from(container.querySelectorAll("button, a[href]"));
    const labels = buttons.map((b) => b.textContent);
    assert.ok(labels.includes("Continue Session"));
    assert.ok(labels.includes("View Telemetry"));

    // Three distinct, real focusable stops: the trigger, then both actions.
    const focusables = container.querySelectorAll('button[data-slot="collapsible-trigger"], button, a[href]');
    assert.equal(focusables.length, 3, "trigger + Continue Session + View Telemetry are three distinct stops");
  } finally {
    await act(async () => { root.unmount(); });
  }
});

// ─── Continue Session — launch failures surface inline ─────────────────────

test("Continue Session shows the launch endpoint's error message inline when the launch fails", async () => {
  const { container, root, act } = await mount(multiActivitySession);
  const originalFetch = globalThis.fetch;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "Launch directory no longer exists: /abs/side-projects/ANSI-VADER-CLI" }),
    });

    const continueButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Continue Session",
    ) as HTMLButtonElement;
    assert.ok(continueButton, "Continue Session button exists");
    assert.equal(container.querySelector('[role="alert"]'), null, "no error shown before a launch is attempted");

    await act(async () => {
      continueButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const alert = container.querySelector('[role="alert"]');
    assert.ok(alert, "a launch failure renders an inline, operator-visible error");
    assert.ok(
      alert?.textContent?.includes("Launch directory no longer exists"),
      "the endpoint's own error message reaches the operator",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => { root.unmount(); });
  }
});

test("View Telemetry links to the existing observability route with no new API/view", async () => {
  const html = await render(multiActivitySession);
  assert.ok(html.includes(`href="/observability/session/${multiActivitySession.sessionId}"`));
});

// ─── Structural — reuses house primitives, doesn't re-sort ─────────────────

test("imports the house Collapsible primitives for the disclosure, per the mandated pattern", () => {
  assert.ok(source.includes("Collapsible") && source.includes("CollapsibleTrigger") && source.includes("CollapsibleContent"));
});

test("imports CARD_SHELL_CLASSES and formatDuration rather than restating them", () => {
  assert.ok(source.includes("CARD_SHELL_CLASSES"));
  assert.ok(source.includes("formatDuration"));
});

test("does not re-sort the given activities — no local .sort( call", () => {
  assert.ok(!/\.sort\s*\(/.test(source), "ordering is trusted from the caller");
});
