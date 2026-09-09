/**
 * Tests for config-field-meta.
 * Run with: npx tsx ui/lib/config-field-meta.test.ts
 */
import assert from 'node:assert';
import { CONFIG_FIELDS, CONFIG_FIELD_MAP } from './config-field-meta';

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

console.log('\nconfig-field-meta tests\n');

// --- CONFIG_FIELDS array ---

test('CONFIG_FIELDS is an array of exactly 9 entries', () => {
  assert.ok(Array.isArray(CONFIG_FIELDS));
  assert.strictEqual(CONFIG_FIELDS.length, 9);
});

test('every entry conforms to FieldMeta interface', () => {
  for (const field of CONFIG_FIELDS) {
    assert.ok(typeof field.key === 'string', `key missing on ${JSON.stringify(field)}`);
    assert.ok(typeof field.label === 'string', `label missing on ${field.key}`);
    assert.ok(typeof field.tooltip === 'string', `tooltip missing on ${field.key}`);
    assert.ok(typeof field.section === 'string', `section missing on ${field.key}`);
    assert.ok(
      ['text', 'number', 'switch', 'toggle-group', 'select', 'readonly'].includes(field.controlType),
      `invalid controlType on ${field.key}: ${field.controlType}`,
    );
  }
});

// --- CONFIG_FIELD_MAP ---

test('CONFIG_FIELD_MAP contains exactly 9 keys matching CONFIG_FIELDS', () => {
  const keys = Object.keys(CONFIG_FIELD_MAP);
  assert.strictEqual(keys.length, 9);
  for (const field of CONFIG_FIELDS) {
    assert.ok(keys.includes(field.key), `missing key in map: ${field.key}`);
  }
});

// --- Specific field lookups ---

test('limits.max_phases and limits.max_tasks_per_phase are gone', () => {
  assert.strictEqual(CONFIG_FIELD_MAP['limits.max_phases'], undefined);
  assert.strictEqual(CONFIG_FIELD_MAP['limits.max_tasks_per_phase'], undefined);
  assert.strictEqual(CONFIG_FIELDS.find(f => f.key === 'limits.max_phases'), undefined);
  assert.strictEqual(CONFIG_FIELDS.find(f => f.key === 'limits.max_tasks_per_phase'), undefined);
});

test('limits.max_retries_per_task has correct metadata', () => {
  const f = CONFIG_FIELD_MAP['limits.max_retries_per_task'];
  assert.ok(f);
  assert.strictEqual(f.label, 'Max Retries per Task');
  assert.strictEqual(f.controlType, 'number');
  assert.strictEqual(f.min, 0);
});

test('the version field and all three human_gates.* fields are removed', () => {
  assert.strictEqual(CONFIG_FIELD_MAP['version'], undefined);
  assert.strictEqual(CONFIG_FIELD_MAP['human_gates.after_planning'], undefined);
  assert.strictEqual(CONFIG_FIELD_MAP['human_gates.execution_mode'], undefined);
  assert.strictEqual(CONFIG_FIELD_MAP['human_gates.after_final_review'], undefined);
  assert.strictEqual(CONFIG_FIELDS.some(f => f.section === 'version'), false);
  assert.strictEqual(CONFIG_FIELDS.some(f => f.section === 'human-gates'), false);
});

test('communication_style.enabled is a switch in the communication-style section', () => {
  const f = CONFIG_FIELD_MAP['communication_style.enabled'];
  assert.ok(f);
  assert.strictEqual(f.label, 'Enabled');
  assert.strictEqual(f.section, 'communication-style');
  assert.strictEqual(f.controlType, 'switch');
});

test('communication_style.selected is a select sourced from communication-styles', () => {
  const f = CONFIG_FIELD_MAP['communication_style.selected'];
  assert.ok(f);
  assert.strictEqual(f.label, 'Style');
  assert.strictEqual(f.section, 'communication-style');
  assert.strictEqual(f.controlType, 'select');
  assert.strictEqual(f.optionsSource, 'communication-styles');
  assert.strictEqual(f.options, undefined);
});

// --- Number field min values ---

test('number fields have correct min values', () => {
  const expected: Record<string, number> = {
    'limits.max_retries_per_task': 0,
    'ui.port': 1,
  };
  for (const [key, minVal] of Object.entries(expected)) {
    const f = CONFIG_FIELD_MAP[key];
    assert.ok(f, `field ${key} not found`);
    assert.strictEqual(f.min, minVal, `${key} min expected ${minVal}, got ${f.min}`);
  }
});

test('ui.port has correct metadata', () => {
  const f = CONFIG_FIELD_MAP['ui.port'];
  assert.ok(f);
  assert.strictEqual(f.label, 'UI Port');
  assert.strictEqual(f.section, 'ui');
  assert.strictEqual(f.controlType, 'number');
  assert.strictEqual(f.min, 1);
});

// --- Toggle-group option values ---

test('all three remaining toggle-group fields have correct options', () => {
  const expected: Record<string, string[]> = {
    'source_control.auto_commit': ['always', 'ask', 'never'],
    'source_control.auto_pr': ['always', 'ask', 'never'],
    'ambient_awareness.verbosity': ['verbose', 'minimal', 'silent', 'off'],
  };
  for (const [key, opts] of Object.entries(expected)) {
    const f = CONFIG_FIELD_MAP[key];
    assert.ok(f, `field ${key} not found`);
    assert.deepStrictEqual(f.options, opts, `${key} options mismatch`);
  }
});

// --- Mutual exclusion: no field has both options and min ---

test('no field has both options and min defined', () => {
  for (const field of CONFIG_FIELDS) {
    const hasBoth = field.options !== undefined && field.min !== undefined;
    assert.ok(!hasBoth, `${field.key} has both options and min`);
  }
});

// --- Case-sensitive option values ---

test('option values are case-sensitive correct', () => {
  const autoCommit = CONFIG_FIELD_MAP['source_control.auto_commit'];
  assert.ok(autoCommit.options!.includes('ask'), "'ask' must be lowercase");
  assert.ok(!autoCommit.options!.includes('Ask'), "'Ask' must not appear");
});

// --- Retired rows pruning ---

test('four retired rows are gone', () => {
  const retired = ['system.orch_root', 'projects.base_path', 'projects.naming', 'source_control.provider'];
  for (const k of retired) {
    assert.strictEqual(CONFIG_FIELD_MAP[k], undefined, `expected ${k} retired`);
    assert.strictEqual(CONFIG_FIELDS.find(f => f.key === k), undefined);
  }
});

test('Projects section is gone entirely', () => {
  const projects = CONFIG_FIELDS.filter(f => f.section === 'projects');
  assert.strictEqual(projects.length, 0);
});

test('default_template row present', () => {
  assert.ok(CONFIG_FIELD_MAP['default_template']);
});

test('ambient_awareness.verbosity has correct metadata', () => {
  const f = CONFIG_FIELD_MAP['ambient_awareness.verbosity'];
  assert.ok(f);
  assert.strictEqual(f.label, 'Verbosity Level');
  assert.strictEqual(f.section, 'ambient-awareness');
  assert.strictEqual(f.controlType, 'toggle-group');
  assert.deepStrictEqual(f.options, ['verbose', 'minimal', 'silent', 'off']);
});

// --- Summary ---

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
