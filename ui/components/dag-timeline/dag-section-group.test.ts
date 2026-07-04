/**
 * Tests for DAGSectionGroup component logic.
 * Run with: npx tsx ui/components/dag-timeline/dag-section-group.test.ts
 *
 * NOTE: Tests use the established .test.ts pattern (no DOM/JSX rendering).
 * Helper functions are exported from dag-section-group.tsx for testability.
 */
import assert from "node:assert";
import {
  computeAriaLabel,
  shouldRender,
  SECTION_LABEL_CLASSES,
} from './dag-section-group';

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

console.log("\nDAGSectionGroup logic tests\n");

// ─── ARIA attributes ────────────────────────────────────────────────────────

test('computeAriaLabel("Planning") returns "Planning section"', () => {
  assert.strictEqual(computeAriaLabel("Planning"), "Planning section");
});

test('computeAriaLabel("Gates") returns "Gates section"', () => {
  assert.strictEqual(computeAriaLabel("Gates"), "Gates section");
});

test('computeAriaLabel("Execution") returns "Execution section"', () => {
  assert.strictEqual(computeAriaLabel("Execution"), "Execution section");
});

test('computeAriaLabel("Completion") returns "Completion section"', () => {
  assert.strictEqual(computeAriaLabel("Completion"), "Completion section");
});

// ─── CSS class composition ──────────────────────────────────────────────────

test('SECTION_LABEL_CLASSES contains "text-xs"', () => {
  assert.ok(SECTION_LABEL_CLASSES.includes("text-xs"), `Expected "text-xs" in "${SECTION_LABEL_CLASSES}"`);
});

test('SECTION_LABEL_CLASSES contains "font-medium"', () => {
  assert.ok(SECTION_LABEL_CLASSES.includes("font-medium"), `Expected "font-medium" in "${SECTION_LABEL_CLASSES}"`);
});

test('SECTION_LABEL_CLASSES contains "uppercase"', () => {
  assert.ok(SECTION_LABEL_CLASSES.includes("uppercase"), `Expected "uppercase" in "${SECTION_LABEL_CLASSES}"`);
});

test('SECTION_LABEL_CLASSES contains "tracking-wide"', () => {
  assert.ok(SECTION_LABEL_CLASSES.includes("tracking-wide"), `Expected "tracking-wide" in "${SECTION_LABEL_CLASSES}"`);
});

test('SECTION_LABEL_CLASSES contains "text-muted-foreground"', () => {
  assert.ok(SECTION_LABEL_CLASSES.includes("text-muted-foreground"), `Expected "text-muted-foreground" in "${SECTION_LABEL_CLASSES}"`);
});

test('SECTION_LABEL_CLASSES contains "mb-1"', () => {
  assert.ok(SECTION_LABEL_CLASSES.includes("mb-1"), `Expected "mb-1" in "${SECTION_LABEL_CLASSES}"`);
});

test('SECTION_LABEL_CLASSES is exactly "text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1"', () => {
  assert.strictEqual(
    SECTION_LABEL_CLASSES,
    "text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1"
  );
});

// ─── Empty children guard ───────────────────────────────────────────────────

test('shouldRender(0) returns false (empty children → render nothing)', () => {
  assert.strictEqual(shouldRender(0), false);
});

test('shouldRender(1) returns true (one child → render content)', () => {
  assert.strictEqual(shouldRender(1), true);
});

test('shouldRender(3) returns true (multiple children → render content)', () => {
  assert.strictEqual(shouldRender(3), true);
});

// ─── Card variant tests (FR-13, FR-14, FR-15, AD-4, AD-5, DD-9, DD-10) ──────

import { isCardSection, CARD_SHELL_CLASSES } from './dag-section-group';

console.log("DAGSectionGroup card-variant tests\n");

test("FR-14 Completion is a card section (DD-9)", () => {
  assert.strictEqual(isCardSection("Completion"), true);
});

test("FR-15 Execution is NOT a card section (DD-10)", () => {
  assert.strictEqual(isCardSection("Execution"), false);
});

test("AD-5 CARD_SHELL_CLASSES uses border + rounded + bg-card tokens", () => {
  assert.ok(CARD_SHELL_CLASSES.includes("border"));
  assert.ok(CARD_SHELL_CLASSES.includes("rounded"));
  assert.ok(CARD_SHELL_CLASSES.includes("bg-card"));
});

test("CARD_SHELL_CLASSES carries no bottom margin so the flex gap is the sole inter-section spacing", () => {
  // The card must not add its own mb-* — section spacing is owned entirely by
  // the surrounding `flex flex-col gap-3` container, keeping every section gap
  // equidistant (no double-gap below the Planning/Completion cards).
  assert.ok(!CARD_SHELL_CLASSES.includes("mb-3"));
});

test("isCardSection + CARD_SHELL_CLASSES applies shell classes only to card sections (DD-9, DD-10)", () => {
  assert.strictEqual((isCardSection("Completion") ? CARD_SHELL_CLASSES : ""), CARD_SHELL_CLASSES);
  assert.strictEqual((isCardSection("Execution") ? CARD_SHELL_CLASSES : ""), "");
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
