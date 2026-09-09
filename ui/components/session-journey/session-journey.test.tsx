import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionJourney, buildSessionJourneySummary } from "./session-journey";
import type { JourneySession } from "@/lib/journey-model";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const source = readFileSync(join(__dirname, "session-journey.tsx"), "utf-8");

function makeSession(overrides: Partial<JourneySession>): JourneySession {
  return {
    sessionId: "sid-1",
    name: "A session",
    harness: "claude",
    cwd: "/abs/DEMO",
    cwdLabel: "DEMO",
    createdAt: "2026-08-30T00:00:00Z",
    lastSeenAt: "2026-08-30T00:10:00Z",
    activeTimeMs: 5 * 60_000,
    activity: [{ type: "execution", description: "Resuming execution.", at: "2026-08-30T00:10:00Z" }],
    ...overrides,
  };
}

function render(props: Parameters<typeof SessionJourney>[0]): string {
  return renderToStaticMarkup(createElement(SessionJourney, props));
}

// ─── buildSessionJourneySummary — pure helper ──────────────────────────────

test("no sessions → no summary", () => {
  assert.equal(buildSessionJourneySummary(0, 0), null);
});

test("one session, singular label", () => {
  assert.equal(buildSessionJourneySummary(1, 5 * 60_000), "1 session · 5m active");
});

test("several sessions with active time", () => {
  assert.equal(buildSessionJourneySummary(4, 80 * 60_000), "4 sessions · 1h 20m active");
});

test("sessions present but zero total active time omits the duration, not '<1m'", () => {
  assert.equal(buildSessionJourneySummary(3, 0), "3 sessions");
});

test("summary never contains a cost figure — no cost is in scope this iteration", () => {
  const summary = buildSessionJourneySummary(4, 80 * 60_000)!;
  assert.ok(!/[$€£]/.test(summary), "no currency symbol in the summary");
});

// ─── Section rendering ──────────────────────────────────────────────────────

test("empty: renders the empty-state card and the header with no counts", () => {
  const html = render({ projectName: "DEMO", sessions: [], totalActiveTimeMs: 0 });
  assert.ok(html.includes("Session Journey"));
  assert.ok(html.includes("No sessions have been recorded."));
  assert.ok(!html.includes("session ·") && !html.includes("sessions ·"), "no counts in the empty state");
});

test("non-empty: renders one card per session, in the given order, with the summary", () => {
  const sessions = [
    makeSession({ sessionId: "a", name: "First" }),
    makeSession({ sessionId: "b", name: "Second" }),
  ];
  const html = render({ projectName: "DEMO", sessions, totalActiveTimeMs: 10 * 60_000 });
  assert.ok(html.includes("2 sessions · 10m active"));
  const firstIdx = html.indexOf("First");
  const secondIdx = html.indexOf("Second");
  assert.ok(firstIdx !== -1 && secondIdx !== -1 && firstIdx < secondIdx, "cards render in the given order, not re-sorted");
});

test("threads projectName down to each session card's launch control", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><div id=\"root\"></div>");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;

  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");

  const calledUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = (url: string) => { calledUrls.push(url); return Promise.resolve({ ok: true }); };

  const sessions = [makeSession({ sessionId: "a" })];
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SessionJourney, { projectName: "MY-PROJECT", sessions, totalActiveTimeMs: 0 }));
  });

  const continueButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Continue Session")!;
  assert.ok(continueButton, "Continue Session control renders");
  await act(async () => { continueButton.click(); });

  assert.deepEqual(calledUrls, ["/api/projects/MY-PROJECT/sessions/a/launch"], "posts to the launch endpoint for this project/session");

  await act(async () => { root.unmount(); });
  globalThis.fetch = originalFetch;
});

// ─── Structural — imports the shared section-label constant ───────────────

test("imports SECTION_LABEL_CLASSES rather than restating it", () => {
  assert.ok(source.includes("SECTION_LABEL_CLASSES"));
});

test("does not re-sort the given sessions — no local .sort( call", () => {
  assert.ok(!/\.sort\s*\(/.test(source));
});
