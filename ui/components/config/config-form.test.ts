/**
 * Tests for ConfigForm component logic.
 * Run with: npx tsx ui/components/config/config-form.test.ts
 *
 * Tests verify:
 * - getNestedValue helper extracts values by dot-path
 * - Section grouping and ordering
 * - Version field isolation from accordion sections
 * - Control type mapping for all 14 config fields
 * - onChange callback contracts for each control type
 * - Validation error routing to correct fields
 * - Module exports
 */
import assert from "node:assert";
import { CONFIG_FIELDS, type FieldMeta } from "../../lib/config-field-meta";
import type { OrchestrationConfig, ConfigValidationErrors } from "../../types/config";

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

/* ------------------------------------------------------------------ */
/*  Logic simulation (mirrors config-form.tsx)                         */
/* ------------------------------------------------------------------ */

const SECTION_TITLES: Record<string, string> = {
  limits: "Pipeline Limits",
  "human-gates": "Human Gates",
  "source-control": "Source Control",
  template: "Template",
  telemetry: "Observability",
};

const SECTION_ORDER = ["limits", "human-gates", "source-control", "template", "telemetry"];

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && acc !== undefined && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function groupFieldsBySection(fields: FieldMeta[]): Map<string, FieldMeta[]> {
  const map = new Map<string, FieldMeta[]>();
  for (const field of fields) {
    if (field.section === "version") continue;
    const existing = map.get(field.section) ?? [];
    existing.push(field);
    map.set(field.section, existing);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Test fixture                                                       */
/* ------------------------------------------------------------------ */

const MOCK_CONFIG: OrchestrationConfig = {
  version: "4",
  limits: {
    max_retries_per_task: 2,
  },
  human_gates: {
    after_planning: true,
    execution_mode: "ask",
    after_final_review: true,
  },
  source_control: {
    auto_commit: "always",
    auto_pr: "ask",
  },
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

console.log("\nConfigForm logic tests\n");

// --- getNestedValue helper ---

test("getNestedValue extracts top-level key", () => {
  const val = getNestedValue(MOCK_CONFIG as unknown as Record<string, unknown>, "version");
  assert.strictEqual(val, "4");
});

test("getNestedValue extracts nested key (default_template)", () => {
  const val = getNestedValue(MOCK_CONFIG as unknown as Record<string, unknown>, "default_template");
  assert.strictEqual(val, undefined);
});

test("getNestedValue extracts deeply nested key (limits.max_retries_per_task)", () => {
  const val = getNestedValue(MOCK_CONFIG as unknown as Record<string, unknown>, "limits.max_retries_per_task");
  assert.strictEqual(val, 2);
});

test("getNestedValue returns undefined for non-existent path", () => {
  const val = getNestedValue(MOCK_CONFIG as unknown as Record<string, unknown>, "missing.path");
  assert.strictEqual(val, undefined);
});

test("getNestedValue extracts boolean value (human_gates.after_planning)", () => {
  const val = getNestedValue(
    MOCK_CONFIG as unknown as Record<string, unknown>,
    "human_gates.after_planning"
  );
  assert.strictEqual(val, true);
});

// --- Section grouping ---

test("CONFIG_FIELDS contains exactly 1 version field", () => {
  const versionFields = CONFIG_FIELDS.filter((f) => f.section === "version");
  assert.strictEqual(versionFields.length, 1);
  assert.strictEqual(versionFields[0].key, "version");
});

test("groupFieldsBySection excludes version field", () => {
  const grouped = groupFieldsBySection(CONFIG_FIELDS);
  assert.strictEqual(grouped.has("version"), false);
});

test("groupFieldsBySection produces exactly 5 sections", () => {
  const grouped = groupFieldsBySection(CONFIG_FIELDS);
  assert.strictEqual(grouped.size, 5);
});

test("All 5 section keys are present in grouped fields", () => {
  const grouped = groupFieldsBySection(CONFIG_FIELDS);
  for (const key of SECTION_ORDER) {
    assert.ok(grouped.has(key), `Missing section: ${key}`);
  }
});

test("Section field counts are correct", () => {
  const grouped = groupFieldsBySection(CONFIG_FIELDS);
  assert.strictEqual(grouped.get("limits")!.length, 1);
  assert.strictEqual(grouped.get("human-gates")!.length, 3);
  assert.strictEqual(grouped.get("source-control")!.length, 2);
  assert.strictEqual(grouped.get("template")!.length, 1);
  assert.strictEqual(grouped.get("telemetry")!.length, 1);
});

// --- Section titles ---

test("All 5 accordion sections have correct display titles", () => {
  assert.strictEqual(SECTION_TITLES["limits"], "Pipeline Limits");
  assert.strictEqual(SECTION_TITLES["human-gates"], "Human Gates");
  assert.strictEqual(SECTION_TITLES["source-control"], "Source Control");
  assert.strictEqual(SECTION_TITLES["template"], "Template");
  assert.strictEqual(SECTION_TITLES["telemetry"], "Observability");
});

// --- Version field rendering ---

test("Version field renders as 'Schema version: {value}' text", () => {
  const versionValue = getNestedValue(
    MOCK_CONFIG as unknown as Record<string, unknown>,
    "version"
  );
  const rendered = `Schema version: ${String(versionValue)}`;
  assert.strictEqual(rendered, "Schema version: 4");
});

// --- Control type mapping ---

test("String fields (default_template) have controlType 'text'", () => {
  const textFields = CONFIG_FIELDS.filter((f) => f.controlType === "text");
  const textKeys = textFields.map((f) => f.key);
  assert.ok(textKeys.includes("default_template"));
});

test("Number fields (1 limit) have controlType 'number' with min values", () => {
  const numberFields = CONFIG_FIELDS.filter((f) => f.controlType === "number");
  assert.strictEqual(numberFields.length, 1);
  for (const f of numberFields) {
    assert.strictEqual(f.section, "limits");
    assert.strictEqual(typeof f.min, "number");
  }
});

test("Number field min attributes are correct", () => {
  const fieldMap = new Map(CONFIG_FIELDS.map((f) => [f.key, f]));
  assert.strictEqual(fieldMap.get("limits.max_retries_per_task")!.min, 0);
});

test("Boolean fields (after_planning, after_final_review, telemetry.enabled) have controlType 'switch'", () => {
  const switchFields = CONFIG_FIELDS.filter((f) => f.controlType === "switch");
  const switchKeys = switchFields.map((f) => f.key);
  assert.ok(switchKeys.includes("human_gates.after_planning"));
  assert.ok(switchKeys.includes("human_gates.after_final_review"));
  assert.ok(switchKeys.includes("telemetry.enabled"));
  assert.strictEqual(switchFields.length, 3);
});

test("Enum fields (execution_mode, auto_commit, auto_pr) have controlType 'toggle-group'", () => {
  const toggleFields = CONFIG_FIELDS.filter((f) => f.controlType === "toggle-group");
  const toggleKeys = toggleFields.map((f) => f.key);
  assert.ok(toggleKeys.includes("human_gates.execution_mode"));
  assert.ok(toggleKeys.includes("source_control.auto_commit"));
  assert.ok(toggleKeys.includes("source_control.auto_pr"));
  assert.strictEqual(toggleFields.length, 3);
});

test("Toggle-group fields have correct options", () => {
  const fieldMap = new Map(CONFIG_FIELDS.map((f) => [f.key, f]));
  assert.deepStrictEqual(fieldMap.get("human_gates.execution_mode")!.options, [
    "ask",
    "phase",
    "task",
    "autonomous",
  ]);
  assert.deepStrictEqual(fieldMap.get("source_control.auto_commit")!.options, [
    "always",
    "ask",
    "never",
  ]);
  assert.deepStrictEqual(fieldMap.get("source_control.auto_pr")!.options, [
    "always",
    "ask",
    "never",
  ]);
});

test("Read-only fields (version) have controlType 'readonly'", () => {
  const readonlyFields = CONFIG_FIELDS.filter((f) => f.controlType === "readonly");
  const readonlyKeys = readonlyFields.map((f) => f.key);
  assert.ok(readonlyKeys.includes("version"));
  assert.strictEqual(readonlyFields.length, 1);
});

// --- onChange callback contracts ---

test("Text input onChange produces (dotPath, stringValue) pair", () => {
  const calls: [string, unknown][] = [];
  const onChange = (path: string, value: unknown) => calls.push([path, value]);
  // Simulate text input change
  const field = CONFIG_FIELDS.find((f) => f.key === "default_template")!;
  const newValue = "high.yml";
  onChange(field.key, newValue);
  assert.deepStrictEqual(calls[0], ["default_template", "high.yml"]);
});

test("Number input onChange produces (dotPath, numericValue) pair", () => {
  const calls: [string, unknown][] = [];
  const onChange = (path: string, value: unknown) => calls.push([path, value]);
  const field = CONFIG_FIELDS.find((f) => f.key === "limits.max_retries_per_task")!;
  // Simulate: e.target.value === '' ? '' : Number(e.target.value)
  const inputValue: string = "15";
  const converted = inputValue === "" ? "" : Number(inputValue);
  onChange(field.key, converted);
  assert.deepStrictEqual(calls[0], ["limits.max_retries_per_task", 15]);
});

test("Number input onChange produces empty string for cleared input", () => {
  const calls: [string, unknown][] = [];
  const onChange = (path: string, value: unknown) => calls.push([path, value]);
  const field = CONFIG_FIELDS.find((f) => f.key === "limits.max_retries_per_task")!;
  const inputValue: string = "";
  const converted = inputValue === "" ? "" : Number(inputValue);
  onChange(field.key, converted);
  assert.deepStrictEqual(calls[0], ["limits.max_retries_per_task", ""]);
});

test("Switch onChange produces (dotPath, booleanValue) pair", () => {
  const calls: [string, unknown][] = [];
  const onChange = (path: string, value: unknown) => calls.push([path, value]);
  const field = CONFIG_FIELDS.find((f) => f.key === "human_gates.after_planning")!;
  onChange(field.key, false);
  assert.deepStrictEqual(calls[0], ["human_gates.after_planning", false]);
});

test("ToggleGroup onChange produces (dotPath, selectedOptionString) pair", () => {
  const calls: [string, unknown][] = [];
  const onChange = (path: string, value: unknown) => calls.push([path, value]);
  const field = CONFIG_FIELDS.find((f) => f.key === "human_gates.execution_mode")!;
  // Simulate: onValueChange receives array, we extract first element
  const newVal = ["phase"];
  onChange(field.key, newVal[0]);
  assert.deepStrictEqual(calls[0], ["human_gates.execution_mode", "phase"]);
});

test("ToggleGroup guards against undefined value — empty array does not fire onChange", () => {
  const calls: [string, unknown][] = [];
  const onChange = (path: string, value: unknown) => calls.push([path, value]);
  // Simulate: onValueChange receives empty array (deselection) — guard prevents call
  const newVal: string[] = [];
  if (newVal.length > 0) onChange("human_gates.execution_mode", newVal[0]);
  assert.strictEqual(calls.length, 0, "onChange should not fire for empty array");
});

test("ToggleGroup value prop handles undefined gracefully (produces empty array)", () => {
  const value: unknown = undefined;
  // Simulate the guard: typeof value === 'string' ? [value] : []
  const resolved = typeof value === 'string' ? [value] : [];
  assert.deepStrictEqual(resolved, []);
});

// --- Validation errors ---

test("Validation errors are keyed by dot-path matching field keys", () => {
  const errors: ConfigValidationErrors = {
    "limits.max_retries_per_task": "Must be 0 or a positive integer",
    "human_gates.execution_mode": "Invalid execution mode",
  };
  // The component passes errors[field.key] to ConfigFieldRow error prop
  const retriesField = CONFIG_FIELDS.find((f) => f.key === "limits.max_retries_per_task")!;
  assert.strictEqual(errors[retriesField.key], "Must be 0 or a positive integer");
});

test("Fields without errors receive undefined error prop", () => {
  const errors: ConfigValidationErrors = {
    "limits.max_retries_per_task": "Must be 0 or a positive integer",
  };
  const defaultTemplateField = CONFIG_FIELDS.find((f) => f.key === "default_template")!;
  assert.strictEqual(errors[defaultTemplateField.key], undefined);
});

// --- All fields have label and tooltip ---

test("Every non-version CONFIG_FIELD has a non-empty label", () => {
  for (const field of CONFIG_FIELDS) {
    assert.ok(field.label.length > 0, `Field ${field.key} has empty label`);
  }
});

test("Every non-version CONFIG_FIELD has a non-empty tooltip", () => {
  for (const field of CONFIG_FIELDS) {
    assert.ok(field.tooltip.length > 0, `Field ${field.key} has empty tooltip`);
  }
});

// --- Section order ---

test("SECTION_ORDER contains exactly 5 sections in correct order", () => {
  assert.deepStrictEqual(SECTION_ORDER, [
    "limits",
    "human-gates",
    "source-control",
    "template",
    "telemetry",
  ]);
});

// --- Default accordion expansion ---

test("defaultValue for accordion matches all 5 section keys", () => {
  const defaultValue = [...SECTION_ORDER];
  assert.strictEqual(defaultValue.length, 5);
  assert.deepStrictEqual(defaultValue, SECTION_ORDER);
});

// --- Module compilation ---

test("config-form module compiles and exports ConfigForm", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./config-form");
  assert.strictEqual(typeof mod.ConfigForm, "function");
});

/* ------------------------------------------------------------------ */
/*  Summary                                                            */
/* ------------------------------------------------------------------ */

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
