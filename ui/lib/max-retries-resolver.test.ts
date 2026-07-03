/**
 * Tests for maxRetries derivation logic in page.tsx.
 * Run with: npx tsx ui/lib/max-retries-resolver.test.ts
 *
 * The maxRetries value shown in RetryBadge should come from the per-project
 * state.json config snapshot when available, falling back to the global
 * /api/config value. This prevents WORKSPACE_ROOT mismatches from causing
 * the wrong "max" denominator in the retry badge.
 *
 * Simulates: projectState?.config?.limits?.max_retries_per_task ?? globalMaxRetries
 */
import assert from "node:assert";

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

interface StateConfigLimits {
  max_retries_per_task?: number;
}
interface StateConfig {
  limits: StateConfigLimits;
}
interface MockProjectState {
  config?: StateConfig;
}

function resolveMaxRetries(projectState: MockProjectState | null, globalMaxRetries: number): number {
  return projectState?.config?.limits?.max_retries_per_task ?? globalMaxRetries;
}

console.log("maxRetries resolution logic");

test("project state config wins over global (5 vs 2)", () => {
  const state: MockProjectState = { config: { limits: { max_retries_per_task: 5 } } };
  assert.strictEqual(resolveMaxRetries(state, 2), 5);
});

test("project state config used when matching global (5 vs 5)", () => {
  const state: MockProjectState = { config: { limits: { max_retries_per_task: 5 } } };
  assert.strictEqual(resolveMaxRetries(state, 5), 5);
});

test("null projectState falls back to global", () => {
  assert.strictEqual(resolveMaxRetries(null, 3), 3);
});

test("projectState with undefined config falls back to global", () => {
  const state: MockProjectState = {};
  assert.strictEqual(resolveMaxRetries(state, 3), 3);
});

test("projectState config with missing max_retries_per_task falls back to global", () => {
  const state: MockProjectState = { config: { limits: {} } };
  assert.strictEqual(resolveMaxRetries(state, 4), 4);
});

test("zero is a valid value — not treated as falsy (uses ?? not ||)", () => {
  const state: MockProjectState = { config: { limits: { max_retries_per_task: 0 } } };
  assert.strictEqual(resolveMaxRetries(state, 3), 0);
});

test("large project value wins over smaller global", () => {
  const state: MockProjectState = { config: { limits: { max_retries_per_task: 10 } } };
  assert.strictEqual(resolveMaxRetries(state, 3), 10);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
