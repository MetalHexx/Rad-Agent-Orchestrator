/**
 * Tests for PipelineTierBadge component logic.
 * Run with: npx tsx ui/components/badges/pipeline-tier-badge.test.ts
 *
 * Tests the decision table that maps tier × sub-status to
 * label, ariaLabel, cssVar, and isSpinning values.
 */
import assert from "node:assert";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PENDING_REVIEW_LABEL, PENDING_REVIEW_CSS_VAR } from "./pending-review";
import { PipelineTierBadge } from "./pipeline-tier-badge";
import { deriveGateBadgeStatusAndLabel } from "../dag-timeline/dag-timeline-helpers";
import type { GateNodeState } from "@/types/state";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

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

// ─── Types (mirrored from @/types/state) ─────────────────────────────────────

type PipelineTier = "planning" | "execution" | "review" | "complete" | "halted";
type PlanningStatus = "not_started" | "in_progress" | "complete";
type ExecutionStatus = "not_started" | "in_progress" | "complete" | "halted";

// ─── Simulation (mirrors pipeline-tier-badge.tsx logic) ──────────────────────
// Kept in lockstep with the source's decision table — a stale mirror here
// would let this suite go on passing while asserting labels the component no
// longer produces.

const TIER_CONFIG = {
  planning: { label: "Planning", cssVar: "--tier-planning" },
  // label is never used directly for execution — resolveBadgeState() sets it explicitly per sub-status
  execution: { label: "Approved", cssVar: "--tier-execution" },
  review: { label: "Pending Review", cssVar: "--tier-review" },
  complete: { label: "Complete", cssVar: "--tier-complete" },
  halted: { label: "Halted", cssVar: "--tier-halted" },
  not_initialized: { label: "Not Initialized", cssVar: "--tier-not-initialized" },
} satisfies Record<PipelineTier | "not_initialized", { label: string; cssVar: string }>;

function resolveBadgeState(
  tier: PipelineTier | "not_initialized",
  planningStatus: PlanningStatus | undefined,
  executionStatus: ExecutionStatus | undefined,
): { label: string; ariaLabel: string; isSpinning: boolean; cssVar: string } {
  const base = TIER_CONFIG[tier];
  let cssVar = base.cssVar;

  let label: string;
  let isSpinning: boolean;

  if (tier === "planning") {
    if (planningStatus === "in_progress") {
      label = "Planning";
      isSpinning = true;
    } else if (planningStatus === "complete") {
      label = "Planned";
      isSpinning = false;
    } else if (planningStatus === "not_started") {
      label = "Not Started";
      isSpinning = false;
    } else {
      label = "Planning";
      isSpinning = false;
    }
  } else if (tier === "execution") {
    if (executionStatus === "halted") {
      label = "Halted";
      cssVar = "--tier-halted";
      isSpinning = false;
    } else if (executionStatus === "in_progress") {
      label = "Executing";
      isSpinning = true;
    } else {
      // not_started, complete, or undefined → queued state awaiting a person
      label = "Pending Review";
      cssVar = "--tier-review";
      isSpinning = false;
    }
  } else if (tier === "review") {
    if (executionStatus === "halted") {
      label = "Halted";
      cssVar = "--tier-halted";
      isSpinning = false;
    } else if (executionStatus === "in_progress") {
      label = "Executing";
      cssVar = "--tier-execution";
      isSpinning = true; // corrective in flight
    } else {
      label = "Pending Review";
      isSpinning = false; // parked at the gate
    }
  } else {
    label = base.label;
    isSpinning = false;
  }

  const ariaLabel = isSpinning
    ? `Pipeline status: ${label}, active`
    : `Pipeline status: ${label}`;

  return { label, ariaLabel, isSpinning, cssVar };
}

// ─── Decision Table Tests ─────────────────────────────────────────────────────

console.log("\nPipelineTierBadge — decision table\n");

// Row 1: not_initialized
console.log("Row 1: not_initialized");

test('not_initialized → label "Not Initialized"', () => {
  const result = resolveBadgeState("not_initialized", undefined, undefined);
  assert.strictEqual(result.label, "Not Initialized");
});

test("not_initialized → no spinner", () => {
  const result = resolveBadgeState("not_initialized", undefined, undefined);
  assert.strictEqual(result.isSpinning, false);
});

test('not_initialized → ariaLabel "Pipeline status: Not Initialized"', () => {
  const result = resolveBadgeState("not_initialized", undefined, undefined);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Not Initialized");
});

test("not_initialized → cssVar --tier-not-initialized", () => {
  const result = resolveBadgeState("not_initialized", undefined, undefined);
  assert.strictEqual(result.cssVar, "--tier-not-initialized");
});

// Row 2: planning + in_progress → spinner
console.log("\nRow 2: planning + planningStatus=in_progress (spinner)");

test('planning + in_progress → label "Planning"', () => {
  const result = resolveBadgeState("planning", "in_progress", undefined);
  assert.strictEqual(result.label, "Planning");
});

test("planning + in_progress → spinner active", () => {
  const result = resolveBadgeState("planning", "in_progress", undefined);
  assert.strictEqual(result.isSpinning, true);
});

test('planning + in_progress → ariaLabel "Pipeline status: Planning, active"', () => {
  const result = resolveBadgeState("planning", "in_progress", undefined);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Planning, active");
});

// Row 3: planning + complete → "Planned"
console.log('\nRow 3: planning + planningStatus=complete → "Planned"');

test('planning + complete → label "Planned"', () => {
  const result = resolveBadgeState("planning", "complete", undefined);
  assert.strictEqual(result.label, "Planned");
});

test("planning + complete → no spinner", () => {
  const result = resolveBadgeState("planning", "complete", undefined);
  assert.strictEqual(result.isSpinning, false);
});

test('planning + complete → ariaLabel "Pipeline status: Planned"', () => {
  const result = resolveBadgeState("planning", "complete", undefined);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Planned");
});

// Row 4: planning + absent planningStatus → fallback "Planning"
console.log("\nRow 4: planning + no planningStatus (backward compat fallback)");

test('planning + undefined planningStatus → label "Planning"', () => {
  const result = resolveBadgeState("planning", undefined, undefined);
  assert.strictEqual(result.label, "Planning");
});

test("planning + undefined planningStatus → no spinner", () => {
  const result = resolveBadgeState("planning", undefined, undefined);
  assert.strictEqual(result.isSpinning, false);
});

test('planning + undefined planningStatus → ariaLabel "Pipeline status: Planning"', () => {
  const result = resolveBadgeState("planning", undefined, undefined);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Planning");
});

test('planning + not_started planningStatus → label "Not Started"', () => {
  const result = resolveBadgeState("planning", "not_started", undefined);
  assert.strictEqual(result.label, "Not Started");
  assert.strictEqual(result.isSpinning, false);
});

test('planning + not_started planningStatus → ariaLabel "Pipeline status: Not Started"', () => {
  const result = resolveBadgeState("planning", "not_started", undefined);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Not Started");
});

// Row 5: execution + in_progress → "Executing" spinner
console.log('\nRow 5: execution + executionStatus=in_progress → "Executing" (spinner)');

test('execution + in_progress → label "Executing"', () => {
  const result = resolveBadgeState("execution", undefined, "in_progress");
  assert.strictEqual(result.label, "Executing");
});

test("execution + in_progress → spinner active", () => {
  const result = resolveBadgeState("execution", undefined, "in_progress");
  assert.strictEqual(result.isSpinning, true);
});

test('execution + in_progress → ariaLabel "Pipeline status: Executing, active"', () => {
  const result = resolveBadgeState("execution", undefined, "in_progress");
  assert.strictEqual(result.ariaLabel, "Pipeline status: Executing, active");
});

// Row 6: execution + absent/other executionStatus → "Pending Review"
console.log('\nRow 6: execution + no/other executionStatus → "Pending Review" (idle, awaiting a person)');

test('execution + undefined executionStatus → label "Pending Review"', () => {
  const result = resolveBadgeState("execution", undefined, undefined);
  assert.strictEqual(result.label, "Pending Review");
});

test("execution + undefined executionStatus → no spinner", () => {
  const result = resolveBadgeState("execution", undefined, undefined);
  assert.strictEqual(result.isSpinning, false);
});

test('execution + undefined executionStatus → ariaLabel "Pipeline status: Pending Review"', () => {
  const result = resolveBadgeState("execution", undefined, undefined);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Pending Review");
});

test('execution + undefined executionStatus → cssVar "--tier-review"', () => {
  const result = resolveBadgeState("execution", undefined, undefined);
  assert.strictEqual(result.cssVar, "--tier-review");
});

test('execution + complete executionStatus → label "Pending Review" (other fallback)', () => {
  const result = resolveBadgeState("execution", undefined, "complete");
  assert.strictEqual(result.label, "Pending Review");
  assert.strictEqual(result.isSpinning, false);
});

// Row 6a: execution + not_started → "Pending Review"
console.log('\nRow 6a: execution + executionStatus=not_started → "Pending Review"');

test('execution + not_started → label "Pending Review"', () => {
  const result = resolveBadgeState("execution", undefined, "not_started");
  assert.strictEqual(result.label, "Pending Review");
  assert.strictEqual(result.isSpinning, false);
  assert.strictEqual(result.cssVar, "--tier-review");
});
test('execution + not_started → ariaLabel "Pipeline status: Pending Review"', () => {
  const result = resolveBadgeState("execution", undefined, "not_started");
  assert.strictEqual(result.ariaLabel, "Pipeline status: Pending Review");
});

// Row 6b: execution + halted → "Halted" with --tier-halted
console.log('\nRow 6b: execution + executionStatus=halted → "Halted"');

test('execution + halted → label "Halted"', () => {
  const result = resolveBadgeState("execution", undefined, "halted");
  assert.strictEqual(result.label, "Halted");
  assert.strictEqual(result.isSpinning, false);
});
test('execution + halted → cssVar "--tier-halted"', () => {
  const result = resolveBadgeState("execution", undefined, "halted");
  assert.strictEqual(result.cssVar, "--tier-halted");
});
test('execution + halted → ariaLabel "Pipeline status: Halted"', () => {
  const result = resolveBadgeState("execution", undefined, "halted");
  assert.strictEqual(result.ariaLabel, "Pipeline status: Halted");
});

// Row 7: review — the gate / corrective-in-flight / halted split
console.log("\nRow 7: review — not_started (gate) / in_progress (corrective) / halted");

test('review + not_started executionStatus → label "Pending Review" (parked at the gate)', () => {
  const result = resolveBadgeState("review", undefined, "not_started");
  assert.strictEqual(result.label, "Pending Review");
  assert.strictEqual(result.isSpinning, false);
  assert.strictEqual(result.cssVar, "--tier-review");
});

test('review + undefined executionStatus → label "Pending Review" (backward-compat default)', () => {
  const result = resolveBadgeState("review", undefined, undefined);
  assert.strictEqual(result.label, "Pending Review");
  assert.strictEqual(result.isSpinning, false);
});

test('review + in_progress executionStatus → label "Executing", spinning, --tier-execution (corrective in flight)', () => {
  const result = resolveBadgeState("review", undefined, "in_progress");
  assert.strictEqual(result.label, "Executing");
  assert.strictEqual(result.isSpinning, true);
  assert.strictEqual(result.cssVar, "--tier-execution");
});

test('review + halted executionStatus → label "Halted", cssVar "--tier-halted"', () => {
  const result = resolveBadgeState("review", undefined, "halted");
  assert.strictEqual(result.label, "Halted");
  assert.strictEqual(result.isSpinning, false);
  assert.strictEqual(result.cssVar, "--tier-halted");
});

test('review → ariaLabel "Pipeline status: Pending Review"', () => {
  const result = resolveBadgeState("review", undefined, undefined);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Pending Review");
});

// Row 8: complete
console.log("\nRow 8: complete");

test('complete → label "Complete"', () => {
  const result = resolveBadgeState("complete", undefined, undefined);
  assert.strictEqual(result.label, "Complete");
});

test("complete → no spinner", () => {
  const result = resolveBadgeState("complete", undefined, undefined);
  assert.strictEqual(result.isSpinning, false);
});

test('complete → ariaLabel "Pipeline status: Complete"', () => {
  const result = resolveBadgeState("complete", undefined, undefined);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Complete");
});

// Row 9: halted
console.log("\nRow 9: halted");

test('halted → label "Halted"', () => {
  const result = resolveBadgeState("halted", undefined, undefined);
  assert.strictEqual(result.label, "Halted");
});

test("halted → no spinner", () => {
  const result = resolveBadgeState("halted", undefined, undefined);
  assert.strictEqual(result.isSpinning, false);
});

test('halted → ariaLabel "Pipeline status: Halted"', () => {
  const result = resolveBadgeState("halted", undefined, undefined);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Halted");
});

// ─── Backward Compatibility ───────────────────────────────────────────────────

console.log("\nBackward compatibility (callers passing only tier)");

test('planning tier only → same as before: "Planning", no spinner', () => {
  const result = resolveBadgeState("planning", undefined, undefined);
  assert.strictEqual(result.label, "Planning");
  assert.strictEqual(result.isSpinning, false);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Planning");
});

test('execution tier only → label is "Pending Review" (idle queued state, no longer "Approved"), no spinner', () => {
  const result = resolveBadgeState("execution", undefined, undefined);
  assert.strictEqual(result.label, "Pending Review");
  assert.strictEqual(result.isSpinning, false);
  assert.strictEqual(result.ariaLabel, "Pipeline status: Pending Review");
});

// ─── aria-label format: must use "Pipeline status:" not "Pipeline tier:" ──────

console.log("\naria-label format");

test('all tiers use "Pipeline status:" format (not "Pipeline tier:")', () => {
  const tiers: Array<PipelineTier | "not_initialized"> = [
    "planning", "execution", "review", "complete", "halted", "not_initialized",
  ];
  for (const tier of tiers) {
    const result = resolveBadgeState(tier, undefined, undefined);
    assert.ok(
      result.ariaLabel.startsWith("Pipeline status:"),
      `Expected ariaLabel to start with "Pipeline status:" but got: "${result.ariaLabel}" for tier="${tier}"`,
    );
    assert.ok(
      !result.ariaLabel.startsWith("Pipeline tier:"),
      `ariaLabel must not use old "Pipeline tier:" format for tier="${tier}"`,
    );
  }
});

test('only spinner states include ", active" suffix', () => {
  // Spinner states
  const spinning1 = resolveBadgeState("planning", "in_progress", undefined);
  const spinning2 = resolveBadgeState("execution", undefined, "in_progress");
  const spinning3 = resolveBadgeState("review", undefined, "in_progress");
  assert.ok(spinning1.ariaLabel.endsWith(", active"), "planning+in_progress should end with ', active'");
  assert.ok(spinning2.ariaLabel.endsWith(", active"), "execution+in_progress should end with ', active'");
  assert.ok(spinning3.ariaLabel.endsWith(", active"), "review+in_progress should end with ', active'");

  // Non-spinner states must NOT include ", active"
  const nonSpinners: Array<Parameters<typeof resolveBadgeState>> = [
    ["not_initialized", undefined, undefined],
    ["planning", "complete", undefined],
    ["planning", undefined, undefined],
    ["execution", undefined, undefined],
    ["review", undefined, undefined],
    ["review", undefined, "halted"],
    ["complete", undefined, undefined],
    ["halted", undefined, undefined],
  ];
  for (const args of nonSpinners) {
    const result = resolveBadgeState(...args);
    assert.ok(
      !result.ariaLabel.includes(", active"),
      `Non-spinner state should not include ", active": tier="${args[0]}", got ariaLabel="${result.ariaLabel}"`,
    );
  }
});

// ─── CSS variable mapping ─────────────────────────────────────────────────────

console.log("\nCSS variable mapping");

test("planning tier → --tier-planning CSS variable", () => {
  const result = resolveBadgeState("planning", "in_progress", undefined);
  assert.strictEqual(result.cssVar, "--tier-planning");
});

test("execution tier → --tier-execution CSS variable", () => {
  const result = resolveBadgeState("execution", undefined, "in_progress");
  assert.strictEqual(result.cssVar, "--tier-execution");
});

test("review tier (parked at the gate) → --tier-review CSS variable", () => {
  assert.strictEqual(resolveBadgeState("review", undefined, undefined).cssVar, "--tier-review");
});

test("complete tier → --tier-complete CSS variable", () => {
  assert.strictEqual(resolveBadgeState("complete", undefined, undefined).cssVar, "--tier-complete");
});

test("halted tier → --tier-halted CSS variable", () => {
  assert.strictEqual(resolveBadgeState("halted", undefined, undefined).cssVar, "--tier-halted");
});

// ─── Badge parity: the project-stage badge and the timeline gate badge ───────
// must emit the exact same label and token for a run parked on a person, so
// they cannot drift apart later.

console.log("\nPending Review badge parity");

test("the project-stage badge (idle execution) and the timeline gate badge (blocking gate) emit the same label and token", () => {
  const gateNode: GateNodeState = { kind: "gate", status: "in_progress", gate_active: true };
  const gate = deriveGateBadgeStatusAndLabel(gateNode);
  assert.strictEqual(gate.label, PENDING_REVIEW_LABEL);
  assert.strictEqual(gate.cssVar, PENDING_REVIEW_CSS_VAR);

  const html = renderToStaticMarkup(
    createElement(PipelineTierBadge, { tier: "execution", executionStatus: "not_started" }),
  );
  assert.ok(html.includes(PENDING_REVIEW_LABEL), "project stage badge renders the shared label");
  assert.ok(html.includes(`var(${PENDING_REVIEW_CSS_VAR})`), "project stage badge renders the shared token");
});

test("no literal hex or Tailwind color string in the rendered project-stage badge", () => {
  const html = renderToStaticMarkup(
    createElement(PipelineTierBadge, { tier: "execution", executionStatus: "not_started" }),
  );
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(html), "no literal hex color");
  assert.ok(
    !/\bbg-(red|amber|green|blue|purple|gray|grey|yellow|orange|slate|zinc)-\d{2,3}\b/.test(html),
    "no Tailwind color class",
  );
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("");
if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} failed.`);
  process.exit(1);
}
