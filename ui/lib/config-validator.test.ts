/**
 * Tests for config-validator.
 * Run with: npx tsx ui/lib/config-validator.test.ts
 */
import assert from 'node:assert';
import { validateConfig } from './config-validator';
import type { OrchestrationConfig } from '@/types/config';

function makeValidConfig(): OrchestrationConfig {
  return {
    version: '4',
    limits: {
      max_retries_per_task: 2,
      max_consecutive_review_rejections: 3,
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

console.log('\nconfig-validator tests\n');

// --- Valid config ---

test('valid config returns empty object', () => {
  const result = validateConfig(makeValidConfig());
  assert.deepStrictEqual(result, {});
  assert.strictEqual(Object.keys(result).length, 0);
});


// --- limits.max_retries_per_task ---

test('limits.max_retries_per_task 0 is valid', () => {
  const cfg = makeValidConfig();
  cfg.limits.max_retries_per_task = 0;
  const result = validateConfig(cfg);
  assert.strictEqual(result['limits.max_retries_per_task'], undefined);
});

test('limits.max_retries_per_task -1 returns error', () => {
  const cfg = makeValidConfig();
  cfg.limits.max_retries_per_task = -1;
  const result = validateConfig(cfg);
  assert.strictEqual(result['limits.max_retries_per_task'], 'Must be 0 or a positive integer');
});

// --- human_gates.after_planning ---

test('human_gates.after_planning non-boolean returns error', () => {
  const cfg = makeValidConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cfg.human_gates as any).after_planning = 'true';
  const result = validateConfig(cfg);
  assert.strictEqual(result['human_gates.after_planning'], 'Must be true or false');
});

test('human_gates.after_planning true is valid', () => {
  const cfg = makeValidConfig();
  cfg.human_gates.after_planning = true;
  const result = validateConfig(cfg);
  assert.strictEqual(result['human_gates.after_planning'], undefined);
});

test('human_gates.after_planning false is valid', () => {
  const cfg = makeValidConfig();
  cfg.human_gates.after_planning = false;
  const result = validateConfig(cfg);
  assert.strictEqual(result['human_gates.after_planning'], undefined);
});

// --- human_gates.execution_mode ---

test('human_gates.execution_mode invalid returns error', () => {
  const cfg = makeValidConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cfg.human_gates as any).execution_mode = 'invalid';
  const result = validateConfig(cfg);
  assert.strictEqual(result['human_gates.execution_mode'], 'Invalid execution mode');
});

for (const mode of ['ask', 'phase', 'task', 'autonomous'] as const) {
  test(`human_gates.execution_mode "${mode}" is valid`, () => {
    const cfg = makeValidConfig();
    cfg.human_gates.execution_mode = mode;
    const result = validateConfig(cfg);
    assert.strictEqual(result['human_gates.execution_mode'], undefined);
  });
}

// --- source_control.auto_commit ---

test('source_control.auto_commit invalid returns error', () => {
  const cfg = makeValidConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cfg.source_control as any).auto_commit = 'invalid';
  const result = validateConfig(cfg);
  assert.strictEqual(result['source_control.auto_commit'], 'Invalid auto commit setting');
});

for (const val of ['always', 'ask', 'never'] as const) {
  test(`source_control.auto_commit "${val}" is valid`, () => {
    const cfg = makeValidConfig();
    cfg.source_control.auto_commit = val;
    const result = validateConfig(cfg);
    assert.strictEqual(result['source_control.auto_commit'], undefined);
  });
}

// --- source_control.auto_pr ---

test('source_control.auto_pr invalid returns error', () => {
  const cfg = makeValidConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cfg.source_control as any).auto_pr = 'invalid';
  const result = validateConfig(cfg);
  assert.strictEqual(result['source_control.auto_pr'], 'Invalid auto PR setting');
});

// --- Multiple errors ---

test('multiple invalid fields returns all errors', () => {
  const cfg = makeValidConfig();
  cfg.limits.max_retries_per_task = -1;
  cfg.limits.max_consecutive_review_rejections = 0;
  const result = validateConfig(cfg);
  assert.strictEqual(result['limits.max_retries_per_task'], 'Must be 0 or a positive integer');
  assert.strictEqual(result['limits.max_consecutive_review_rejections'], 'Must be a positive integer');
  assert.strictEqual(Object.keys(result).length, 2);
});

// --- No mutation ---

test('does not mutate input config', () => {
  const cfg = makeValidConfig();
  const snapshot = JSON.stringify(cfg);
  validateConfig(cfg);
  assert.strictEqual(JSON.stringify(cfg), snapshot);
});

// --- Missing sections ---

test('missing limits section returns section-level error', () => {
  const cfg = makeValidConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (cfg as any).limits;
  const result = validateConfig(cfg);
  assert.strictEqual(result['limits'], 'Missing limits section');
});

test('missing human_gates section returns section-level error', () => {
  const cfg = makeValidConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (cfg as any).human_gates;
  const result = validateConfig(cfg);
  assert.strictEqual(result['human_gates'], 'Missing human_gates section');
});

test('missing source_control section returns section-level error', () => {
  const cfg = makeValidConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (cfg as any).source_control;
  const result = validateConfig(cfg);
  assert.strictEqual(result['source_control'], 'Missing source_control section');
});

test('all sections missing returns all section-level errors', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = { version: '4' } as any;
  const result = validateConfig(cfg);
  assert.strictEqual(result['limits'], 'Missing limits section');
  assert.strictEqual(result['human_gates'], 'Missing human_gates section');
  assert.strictEqual(result['source_control'], 'Missing source_control section');
  assert.strictEqual(Object.keys(result).length, 3);
});

// --- Retired fields pruning ---

test('validator no longer requires retired fields', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errors = validateConfig({
    version: '1.0',
    limits: { max_retries_per_task: 5, max_consecutive_review_rejections: 3 },
    human_gates: { after_planning: true, execution_mode: 'ask', after_final_review: true },
    source_control: { auto_commit: 'ask', auto_pr: 'ask' },
    default_template: 'ask',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  assert.strictEqual(Object.keys(errors).length, 0);
});

// --- telemetry.enabled (FR-6, DD-3) ---

test('an Observability switch field exists for telemetry.enabled (FR-6, DD-3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CONFIG_FIELDS } = require('./config-field-meta');
  const f = (CONFIG_FIELDS as Array<{ key: string; controlType: string; section: string }>).find((x) => x.key === 'telemetry.enabled');
  assert.ok(f, 'field present');
  assert.strictEqual(f!.controlType, 'switch');
  assert.strictEqual(f!.section, 'telemetry');
});

test('validator accepts a boolean and rejects a non-boolean (FR-6)', () => {
  const base = { limits: {}, human_gates: {}, source_control: { auto_commit: 'ask', auto_pr: 'ask' } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.ok(!validateConfig({ ...base, telemetry: { enabled: true } } as any)['telemetry.enabled']);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.ok(validateConfig({ ...base, telemetry: { enabled: 'yes' } } as any)['telemetry.enabled']);
});

// --- Summary ---

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
