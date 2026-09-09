/**
 * Tests for ActivityTypeBadge — a wrapper that composes SpinnerBadge for the
 * eleven session-journey activity types, rather than re-expressing its
 * color-mix treatment locally.
 * Run with: npx tsx ui/components/badges/activity-type-badge.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityTypeBadge } from "./activity-type-badge";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const source = readFileSync(join(__dirname, "activity-type-badge.tsx"), "utf-8");

function render(type: string): string {
  return renderToStaticMarkup(createElement(ActivityTypeBadge, { type }));
}

// ─── Every one of the eleven types maps to a label and an existing token ────

const EXPECTED: Record<string, string> = {
  brainstorming: "--tier-planning",
  requirements: "--tier-planning",
  "master-plan": "--tier-planning",
  amend: "--model-teal",
  execution: "--tier-execution",
  other: "--status-not-started",
  "execution-complete": "--status-complete",
  "final-approved": "--verdict-approved",
  "final-rejected": "--verdict-rejected",
  halted: "--status-halted",
  corrective: "--verdict-changes-requested",
};

for (const [type, cssVar] of Object.entries(EXPECTED)) {
  test(`${type} → renders its own label and var(${cssVar})`, () => {
    const html = render(type);
    assert.ok(html.includes(`>${type}<`), `visible label "${type}" rendered in: ${html}`);
    assert.ok(html.includes(`var(${cssVar})`), `uses ${cssVar} in: ${html}`);
  });
}

// ─── requirements/master-plan share the planning tier; amend vs corrective ──

test("brainstorming, requirements, and master-plan deliberately share the planning tier token", () => {
  assert.equal(EXPECTED.brainstorming, EXPECTED.requirements);
  assert.equal(EXPECTED.requirements, EXPECTED["master-plan"]);
});

test("amend (additive, teal) and corrective (remedial, changes-requested) never share a token", () => {
  assert.notEqual(EXPECTED.amend, EXPECTED.corrective);
  assert.equal(EXPECTED.amend, "--model-teal");
});

// ─── Fallback for an unrecognised value ─────────────────────────────────────

test("an unrecognised type falls back to the `other` entry rather than throwing", () => {
  assert.doesNotThrow(() => render("some-future-type"));
  const html = render("some-future-type");
  assert.ok(html.includes(`var(${EXPECTED.other})`), "falls back to the `other` token");
});

// ─── Never spins — a plain pill, per the eleven-type table ─────────────────

test("no type renders the spinner icon", () => {
  for (const type of Object.keys(EXPECTED)) {
    assert.ok(!render(type).includes("animate-spin"), `${type} must not spin`);
  }
});

// ─── Structural — composes SpinnerBadge, does not restate its treatment ────

test("composes SpinnerBadge rather than a bespoke badge implementation", () => {
  assert.ok(source.includes("SpinnerBadge"), "imports/uses SpinnerBadge");
});

test("does not restate SpinnerBadge's color-mix style expression locally", () => {
  assert.ok(!source.includes("backgroundColor"), "no inline backgroundColor style — that treatment lives only in SpinnerBadge");
  assert.ok(!/style=\{\{/.test(source), "no inline style prop — cssVar is handed to SpinnerBadge, not applied locally");
});
