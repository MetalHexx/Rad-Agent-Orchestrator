/**
 * Tests for PipelineTierBadge — now a pure renderer: colour and spinner come
 * from STATE_PRESENTATION keyed off `state`, and the label is data it's
 * handed, never a word it computes.
 * Run with: npx tsx ui/components/badges/pipeline-tier-badge.test.ts
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PENDING_REVIEW_LABEL, PENDING_REVIEW_CSS_VAR } from "./pending-review";
import { PipelineTierBadge } from "./pipeline-tier-badge";
import { STATE_PRESENTATION } from "./project-state-presentation";
import { deriveGateBadgeStatusAndLabel } from "../dag-timeline/dag-timeline-helpers";
import type { GateNodeState } from "@/types/state";
import type { ProjectState } from "@/types/components";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const badgeSource = readFileSync(join(__dirname, 'pipeline-tier-badge.tsx'), 'utf-8');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

function render(state: ProjectState, label: string): string {
  return renderToStaticMarkup(createElement(PipelineTierBadge, { state, label }));
}

const ALL_STATES: ProjectState[] = [
  'not_initialized', 'not_started', 'planning', 'planned',
  'executing', 'pending_review', 'halted', 'complete',
];

console.log("\nPipelineTierBadge — pure renderer\n");

for (const state of ALL_STATES) {
  test(`${state} → renders the label it is handed, verbatim`, () => {
    const html = render(state, `Label for ${state}`);
    assert.ok(html.includes(`Label for ${state}`), html);
  });

  test(`${state} → ariaLabel is derived from the handed label, "${STATE_PRESENTATION[state].isSpinning ? ', active' : ''}" suffix matches isSpinning`, () => {
    const html = render(state, 'Whatever');
    const expected = STATE_PRESENTATION[state].isSpinning
      ? 'Pipeline status: Whatever, active'
      : 'Pipeline status: Whatever';
    assert.ok(html.includes(`aria-label="${expected}"`), html);
  });

  test(`${state} → cssVar matches STATE_PRESENTATION[state].cssVar`, () => {
    const html = render(state, 'Whatever');
    assert.ok(html.includes(`var(${STATE_PRESENTATION[state].cssVar})`), html);
  });
}

test('only "planning" and "executing" render the spinner icon', () => {
  for (const state of ALL_STATES) {
    const html = render(state, 'Whatever');
    const hasSpinner = html.includes('animate-spin');
    assert.strictEqual(hasSpinner, STATE_PRESENTATION[state].isSpinning, state);
  }
});

// ─── Badge parity: the project-stage badge and the timeline gate badge ───────
// must emit the exact same label and token for a run parked on a person.

console.log("\nPending Review badge parity");

test("the project-stage badge (idle execution) and the timeline gate badge (blocking gate) emit the same label and token", () => {
  const gateNode: GateNodeState = { kind: "gate", status: "in_progress", gate_active: true };
  const gate = deriveGateBadgeStatusAndLabel(gateNode);
  assert.strictEqual(gate.label, PENDING_REVIEW_LABEL);
  assert.strictEqual(gate.cssVar, PENDING_REVIEW_CSS_VAR);

  const html = render('pending_review', PENDING_REVIEW_LABEL);
  assert.ok(html.includes(PENDING_REVIEW_LABEL), "project stage badge renders the shared label");
  assert.ok(html.includes(`var(${PENDING_REVIEW_CSS_VAR})`), "project stage badge renders the shared token");
});

test("no literal hex or Tailwind color string in the rendered project-stage badge", () => {
  const html = render('executing', 'Executing');
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(html), "no literal hex color");
  assert.ok(
    !/\bbg-(red|amber|green|blue|purple|gray|grey|yellow|orange|slate|zinc)-\d{2,3}\b/.test(html),
    "no Tailwind color class",
  );
});

// ─── No reconstructed words ───────────────────────────────────────────────────

console.log("\nNo string literal that is a user-visible state word");

test('pipeline-tier-badge.tsx has no string literal for a user-visible state word', () => {
  const stateWords = [
    'Planning', 'Planned', 'Not Started', 'Executing',
    'Pending Review', 'Halted', 'Complete', 'Not Initialized', 'Approved',
  ];
  for (const word of stateWords) {
    assert.ok(
      !badgeSource.includes(`"${word}"`) && !badgeSource.includes(`'${word}'`),
      `pipeline-tier-badge.tsx must not contain the literal "${word}"`,
    );
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("");
if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} failed.`);
  process.exit(1);
}
