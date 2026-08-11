/**
 * Tests for NodeStatusBadge component logic.
 * Run with: npx tsx ui/components/dag-timeline/node-status-badge.test.ts
 */
import assert from "node:assert";
import { STATUS_MAP } from './node-status-badge';
import type { StatusMapEntry } from './node-status-badge';
import type { NodeStatus } from '@/types/state';

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveProps(status: NodeStatus, label?: string) {
  const entry: StatusMapEntry = STATUS_MAP[status];
  const resolvedLabel = label ?? entry.defaultLabel;
  return {
    cssVar: entry.cssVar,
    isSpinning: entry.isSpinning,
    isComplete: entry.isComplete,
    isRejected: entry.isRejected,
    label: resolvedLabel,
    ariaLabel: resolvedLabel,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log("\nNodeStatusBadge logic tests\n");

// cssVar mapping
test('maps not_started to cssVar "--status-not-started"', () => {
  assert.strictEqual(resolveProps("not_started").cssVar, "--status-not-started");
});
test('maps in_progress to cssVar "--status-in-progress"', () => {
  assert.strictEqual(resolveProps("in_progress").cssVar, "--status-in-progress");
});
test('maps completed to cssVar "--status-complete"', () => {
  assert.strictEqual(resolveProps("completed").cssVar, "--status-complete");
});
test('maps failed to cssVar "--status-failed"', () => {
  assert.strictEqual(resolveProps("failed").cssVar, "--status-failed");
});
test('maps halted to cssVar "--status-halted"', () => {
  assert.strictEqual(resolveProps("halted").cssVar, "--status-halted");
});
test('maps skipped to cssVar "--status-skipped"', () => {
  assert.strictEqual(resolveProps("skipped").cssVar, "--status-skipped");
});

// isSpinning
test("in_progress has isSpinning=true", () => {
  assert.strictEqual(resolveProps("in_progress").isSpinning, true);
});
test("not_started has isSpinning=false", () => {
  assert.strictEqual(resolveProps("not_started").isSpinning, false);
});
test("completed has isSpinning=false", () => {
  assert.strictEqual(resolveProps("completed").isSpinning, false);
});
test("failed has isSpinning=false", () => {
  assert.strictEqual(resolveProps("failed").isSpinning, false);
});
test("halted has isSpinning=false", () => {
  assert.strictEqual(resolveProps("halted").isSpinning, false);
});
test("skipped has isSpinning=false", () => {
  assert.strictEqual(resolveProps("skipped").isSpinning, false);
});

// isComplete
test("completed has isComplete=true", () => {
  assert.strictEqual(resolveProps("completed").isComplete, true);
});
test("not_started has isComplete=false", () => {
  assert.strictEqual(resolveProps("not_started").isComplete, false);
});
test("in_progress has isComplete=false", () => {
  assert.strictEqual(resolveProps("in_progress").isComplete, false);
});
test("failed has isComplete=false", () => {
  assert.strictEqual(resolveProps("failed").isComplete, false);
});
test("halted has isComplete=false", () => {
  assert.strictEqual(resolveProps("halted").isComplete, false);
});
test("skipped has isComplete=false", () => {
  assert.strictEqual(resolveProps("skipped").isComplete, false);
});

// isRejected
test("failed has isRejected=true", () => {
  assert.strictEqual(resolveProps("failed").isRejected, true);
});
test("halted has isRejected=true", () => {
  assert.strictEqual(resolveProps("halted").isRejected, true);
});
test("not_started has isRejected=false", () => {
  assert.strictEqual(resolveProps("not_started").isRejected, false);
});
test("in_progress has isRejected=false", () => {
  assert.strictEqual(resolveProps("in_progress").isRejected, false);
});
test("completed has isRejected=false", () => {
  assert.strictEqual(resolveProps("completed").isRejected, false);
});
test("skipped has isRejected=false", () => {
  assert.strictEqual(resolveProps("skipped").isRejected, false);
});

// default labels
test('not_started default label is "Not Started"', () => {
  assert.strictEqual(resolveProps("not_started").label, "Not Started");
});
test('in_progress default label is "In Progress"', () => {
  assert.strictEqual(resolveProps("in_progress").label, "In Progress");
});
test('completed default label is "Completed"', () => {
  assert.strictEqual(resolveProps("completed").label, "Completed");
});
test('failed default label is "Failed"', () => {
  assert.strictEqual(resolveProps("failed").label, "Failed");
});
test('halted default label is "Halted"', () => {
  assert.strictEqual(resolveProps("halted").label, "Halted");
});
test('skipped default label is "Skipped"', () => {
  assert.strictEqual(resolveProps("skipped").label, "Skipped");
});

// label prop override
test("uses provided label prop over default", () => {
  assert.strictEqual(resolveProps("in_progress", "Custom Label").label, "Custom Label");
});
test("uses default label when no label prop provided", () => {
  assert.strictEqual(resolveProps("completed").label, "Completed");
});

// ariaLabel
test("passes resolved label as ariaLabel to SpinnerBadge", () => {
  assert.strictEqual(resolveProps("failed").ariaLabel, "Failed");
});
test("passes custom label as ariaLabel when label is overridden", () => {
  assert.strictEqual(resolveProps("in_progress", "My Label").ariaLabel, "My Label");
});

// ─── cssVar override prop (FR-1, FR-4, AD-4, DD-1) ───────────────────────────

function resolvePropsWithOverride(status: NodeStatus, label?: string, cssVar?: string) {
  const entry: StatusMapEntry = STATUS_MAP[status];
  const resolvedLabel = label ?? entry.defaultLabel;
  return {
    cssVar: cssVar ?? entry.cssVar,
    isSpinning: entry.isSpinning,
    isComplete: entry.isComplete,
    isRejected: entry.isRejected,
    label: resolvedLabel,
    ariaLabel: resolvedLabel,
  };
}

console.log("\nNodeStatusBadge cssVar override (FR-1, FR-4, AD-4, DD-1) tests\n");

test("cssVar override flows through to SpinnerBadge cssVar prop", () => {
  const r = resolvePropsWithOverride('in_progress', 'Reviewing', '--tier-review');
  assert.strictEqual(r.cssVar, '--tier-review');
});

test("cssVar omitted falls back to STATUS_MAP entry (back-compat)", () => {
  const r = resolvePropsWithOverride('in_progress', 'In Progress');
  assert.strictEqual(r.cssVar, '--status-in-progress');
});

test("cssVar override does not change isSpinning/isComplete/isRejected (DD-1: status drives icon, override drives only color)", () => {
  const r = resolvePropsWithOverride('in_progress', 'Executing', '--tier-execution');
  assert.strictEqual(r.isSpinning, true);
  assert.strictEqual(r.isComplete, false);
  assert.strictEqual(r.isRejected, false);
});

test("cssVar override + iconOnly: visible label suppressed but ariaLabel preserved (NFR-3)", () => {
  // The component's render contract: when iconOnly is set, the
  // SpinnerBadge receives hideLabel=true but ariaLabel still equals
  // the resolved label so screen readers still announce stage.
  const r = resolvePropsWithOverride('completed', 'Reviewing', '--tier-review');
  assert.strictEqual(r.label, 'Reviewing');
  assert.strictEqual(r.ariaLabel, 'Reviewing');
});

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const NSB_SOURCE = readFileSync(join(__dirname, 'node-status-badge.tsx'), 'utf8');

test("AD-4 NodeStatusBadge declares optional cssVar prop in its props interface", () => {
  assert.ok(/cssVar\?\s*:\s*string/.test(NSB_SOURCE),
    "node-status-badge.tsx must declare `cssVar?: string` on NodeStatusBadgeProps");
});

test("AD-4 NodeStatusBadge forwards cssVar to SpinnerBadge with STATUS_MAP fallback", () => {
  // Body must include a fallback expression of the shape `cssVar ?? entry.cssVar`
  // (or `cssVar ?? STATUS_MAP[status].cssVar` / equivalent destructure).
  assert.ok(
    /cssVar\s*\?\?\s*\w+\.cssVar/.test(NSB_SOURCE) ||
    /cssVar\s*\?\?\s*STATUS_MAP\[/.test(NSB_SOURCE),
    "NodeStatusBadge body must use `cssVar ?? <STATUS_MAP entry>.cssVar` fallback",
  );
});

// ─── isSpinning override prop ────────────────────────────────────────────────
// Used by resting states that are in flight but not active work (a gate
// awaiting a person) — the override must win over STATUS_MAP[status].isSpinning.

function resolvePropsWithSpinningOverride(status: NodeStatus, isSpinning?: boolean) {
  const entry: StatusMapEntry = STATUS_MAP[status];
  return { isSpinning: isSpinning ?? entry.isSpinning };
}

console.log("\nNodeStatusBadge isSpinning override tests\n");

test("isSpinning=false override suppresses the STATUS_MAP default spinner on in_progress", () => {
  const r = resolvePropsWithSpinningOverride('in_progress', false);
  assert.strictEqual(r.isSpinning, false);
});

test("isSpinning omitted falls back to STATUS_MAP entry (back-compat)", () => {
  const r = resolvePropsWithSpinningOverride('in_progress');
  assert.strictEqual(r.isSpinning, true);
});

test("isSpinning=true override can also force a spinner on a status that defaults to none", () => {
  const r = resolvePropsWithSpinningOverride('not_started', true);
  assert.strictEqual(r.isSpinning, true);
});

test("NodeStatusBadge declares optional isSpinning prop in its props interface", () => {
  assert.ok(/isSpinning\?\s*:\s*boolean/.test(NSB_SOURCE),
    "node-status-badge.tsx must declare `isSpinning?: boolean` on NodeStatusBadgeProps");
});

test("NodeStatusBadge forwards isSpinning to SpinnerBadge with STATUS_MAP fallback", () => {
  assert.ok(
    /isSpinning\s*\?\?\s*\w+\.isSpinning/.test(NSB_SOURCE),
    "NodeStatusBadge body must use `isSpinning ?? <STATUS_MAP entry>.isSpinning` fallback",
  );
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
