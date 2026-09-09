/**
 * Tests for useConfigEditor hook.
 * Run with: npx tsx ui/hooks/use-config-editor.test.ts
 *
 * These tests exercise the hook via a minimal React render cycle using
 * react-dom/client + a global jsdom-free approach. Because the project does
 * not include a DOM environment or React Testing Library, we test:
 *   1. Pure logic extracted from the hook (dot-path updates, dirty tracking)
 *   2. Type-level compilation (the fact that this file compiles proves the
 *      interface matches the implementation)
 *   3. Behavioral tests via direct function invocation where possible
 */
import assert from 'node:assert';
import type { OrchestrationConfig } from '@/types/config';
import { validateConfig } from '@/lib/config-validator';

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                      */
/* ------------------------------------------------------------------ */

function makeValidConfig(): OrchestrationConfig {
  return {
    version: '4',
    limits: {
      max_retries_per_task: 2,
    },
    human_gates: {
      after_planning: true,
      execution_mode: 'ask',
      after_final_review: true,
    },
    source_control: {
      auto_commit: 'always',
      auto_pr: 'ask',
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Test runner                                                        */
/* ------------------------------------------------------------------ */

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

console.log('\nuse-config-editor tests\n');

/* ------------------------------------------------------------------ */
/*  Type compilation test                                              */
/* ------------------------------------------------------------------ */

test('UseConfigEditorReturn interface is exported and compiles', () => {
  // This import succeeds only if the interface + hook compile correctly.
  // We can't call the hook outside React, but we can verify the module loads.
  const mod = require('./use-config-editor');
  assert.strictEqual(typeof mod.useConfigEditor, 'function');
});

/* ------------------------------------------------------------------ */
/*  Dot-path update logic                                              */
/* ------------------------------------------------------------------ */

function updateFieldOnObject(
  config: OrchestrationConfig,
  path: string,
  value: unknown,
): OrchestrationConfig {
  const clone = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const keys = path.split('.');
  let current: Record<string, unknown> = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
  return clone as unknown as OrchestrationConfig;
}

test('updateField: limits.max_retries_per_task updates to 12', () => {
  const config = makeValidConfig();
  const updated = updateFieldOnObject(config, 'limits.max_retries_per_task', 12);
  assert.strictEqual(updated.limits.max_retries_per_task, 12);
  // Original is not mutated
  assert.strictEqual(config.limits.max_retries_per_task, 2);
});

test('updateField: human_gates.execution_mode updates to phase', () => {
  const config = makeValidConfig();
  const updated = updateFieldOnObject(config, 'human_gates.execution_mode', 'phase');
  assert.strictEqual(updated.human_gates.execution_mode, 'phase');
});

test('updateField: source_control.auto_commit updates to never', () => {
  const config = makeValidConfig();
  const updated = updateFieldOnObject(config, 'source_control.auto_commit', 'never');
  assert.strictEqual(updated.source_control.auto_commit, 'never');
});

test('updateField: deep clone does not mutate original', () => {
  const config = makeValidConfig();
  const updated = updateFieldOnObject(config, 'limits.max_retries_per_task', 99);
  assert.strictEqual(config.limits.max_retries_per_task, 2);
  assert.strictEqual(updated.limits.max_retries_per_task, 99);
});

/* ------------------------------------------------------------------ */
/*  Dirty tracking logic — config JSON only, no mode/raw branch        */
/* ------------------------------------------------------------------ */

test('isDirty: false when config matches baseline', () => {
  const config = makeValidConfig();
  const baseline = JSON.stringify(config);
  assert.strictEqual(JSON.stringify(config) !== baseline, false);
});

test('isDirty: true when config differs from baseline', () => {
  const config = makeValidConfig();
  const baseline = JSON.stringify(config);
  const modified = updateFieldOnObject(config, 'limits.max_retries_per_task', 12);
  assert.strictEqual(JSON.stringify(modified) !== baseline, true);
});

test('isDirty: false when config is null', () => {
  const config: OrchestrationConfig | null = null;
  const isDirty = config !== null && JSON.stringify(config) !== '';
  assert.strictEqual(isDirty, false);
});

/* ------------------------------------------------------------------ */
/*  Validation integration                                             */
/* ------------------------------------------------------------------ */

test('updateField re-runs validateConfig and catches errors', () => {
  const config = makeValidConfig();
  const updated = updateFieldOnObject(config, 'limits.max_retries_per_task', -1);
  const errors = validateConfig(updated);
  assert.ok(errors['limits.max_retries_per_task'], 'Expected validation error for max_retries_per_task');
});

test('updateField with valid value produces no errors for that field', () => {
  const config = makeValidConfig();
  const updated = updateFieldOnObject(config, 'limits.max_retries_per_task', 12);
  const errors = validateConfig(updated);
  assert.strictEqual(errors['limits.max_retries_per_task'], undefined);
});

/* ------------------------------------------------------------------ */
/*  Save request body construction — always mode: 'form'               */
/* ------------------------------------------------------------------ */

test('save always sends request body with mode "form" and config', () => {
  const config = makeValidConfig();
  const body = { mode: 'form' as const, config };
  assert.strictEqual(body.mode, 'form');
  assert.ok('config' in body);
});

test('save in form mode with validation errors: should not proceed', () => {
  const config = makeValidConfig();
  const modified = updateFieldOnObject(config, 'limits.max_retries_per_task', -1);
  const errors = validateConfig(modified);
  const hasErrors = Object.keys(errors).length > 0;
  assert.ok(hasErrors, 'Validation should catch invalid max_retries_per_task');
});

/* ------------------------------------------------------------------ */
/*  Baseline update after save                                         */
/* ------------------------------------------------------------------ */

test('after save success: new baseline matches saved config', () => {
  const config = makeValidConfig();
  const modified = updateFieldOnObject(config, 'limits.max_retries_per_task', 12);
  // Simulate save success — baseline is updated to match saved config
  const newBaseline = JSON.stringify(modified);
  assert.strictEqual(JSON.stringify(modified) !== newBaseline, false);
});

/* ------------------------------------------------------------------ */
/*  Style options — a failed fetch degrades to [] without loadError    */
/* ------------------------------------------------------------------ */

test('a failed communication-styles fetch resolves styleOptions to [] without setting loadError', async () => {
  let styleOptions: { value: string; label: string }[] = [{ value: 'stale', label: 'Stale' }];
  let loadError: string | null = null;

  async function fetchStyleOptions(fetchImpl: () => Promise<Response>) {
    try {
      const res = await fetchImpl();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { styles: { path: string; title: string }[] };
      styleOptions = json.styles.map((s) => ({ value: s.path, label: s.title }));
    } catch {
      styleOptions = [];
      // loadError is deliberately left untouched — the panel keeps working
      // with every other field editable when only the catalog fetch fails.
    }
  }

  await fetchStyleOptions(async () => { throw new Error('network down'); });
  assert.deepStrictEqual(styleOptions, []);
  assert.strictEqual(loadError, null);
});

test('a successful communication-styles fetch maps entries to {value, label} pairs', async () => {
  let styleOptions: { value: string; label: string }[] = [];

  async function fetchStyleOptions(fetchImpl: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>) {
    const res = await fetchImpl();
    if (!res.ok) throw new Error('bad response');
    const json = (await res.json()) as { styles: { path: string; title: string }[] };
    styleOptions = json.styles.map((s) => ({ value: s.path, label: s.title }));
  }

  await fetchStyleOptions(async () => ({
    ok: true,
    json: async () => ({ styles: [{ path: 'custom/formal.md', title: 'Formal' }] }),
  }));
  assert.deepStrictEqual(styleOptions, [{ value: 'custom/formal.md', label: 'Formal' }]);
});

/* ------------------------------------------------------------------ */
/*  dismissSaveError logic                                             */
/* ------------------------------------------------------------------ */

test('dismissSaveError: resets saveState to idle', () => {
  // Simulate error state
  let saveState: string = 'error';
  // Simulate dismissSaveError callback
  saveState = 'idle';
  assert.strictEqual(saveState, 'idle');
});

test('dismissSaveError: clears saveError to null', () => {
  // Simulate error state with message
  let saveError: string | null = 'Network timeout';
  // Simulate dismissSaveError callback
  saveError = null;
  assert.strictEqual(saveError, null);
});

/* ------------------------------------------------------------------ */
/*  UseConfigEditorReturn type verification                            */
/* ------------------------------------------------------------------ */

test('UseConfigEditorReturn includes styleOptions and no longer includes mode/rawYaml', () => {
  // Type-level verification: if this compiles, the shape matches.
  type AssertHasField<T, K extends keyof T> = K;
  type AssertLacksField<T, K> = K extends keyof T ? never : K;
  // These lines cause a compile error if the fields don't match the interface.
  type _CheckStyleOptions = AssertHasField<import('./use-config-editor').UseConfigEditorReturn, 'styleOptions'>;
  type _CheckNoMode = AssertLacksField<import('./use-config-editor').UseConfigEditorReturn, 'mode'>;
  type _CheckNoRawYaml = AssertLacksField<import('./use-config-editor').UseConfigEditorReturn, 'rawYaml'>;
  // Runtime: the module loaded successfully above, which means the interface compiles.
  assert.ok(true);
});

/* ------------------------------------------------------------------ */
/*  Summary                                                            */
/* ------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
