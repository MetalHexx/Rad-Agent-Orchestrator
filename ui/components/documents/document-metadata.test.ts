/**
 * Tests for DocumentMetadata formatting helpers.
 * Run with: npx tsx ui/components/documents/document-metadata.test.ts
 *
 * Covers stringifyFrontmatterItem, which renders array/object frontmatter
 * values as readable strings (regression: naive String(value) produced
 * "[object Object],[object Object]" for phase plan frontmatter like
 * tasks: [{ id, title }, ...]).
 */
import assert from "node:assert";
import { stringifyFrontmatterItem, formatValue } from "./document-metadata";

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

console.log("\nDocumentMetadata frontmatter formatting tests\n");

test("stringifyFrontmatterItem primitive string returns the string", () => {
  assert.strictEqual(stringifyFrontmatterItem("simple"), "simple");
});

test("stringifyFrontmatterItem primitive number returns the stringified number", () => {
  assert.strictEqual(stringifyFrontmatterItem(42), "42");
});

test("stringifyFrontmatterItem primitive boolean returns the stringified boolean", () => {
  assert.strictEqual(stringifyFrontmatterItem(true), "true");
});

test("stringifyFrontmatterItem null returns empty string", () => {
  assert.strictEqual(stringifyFrontmatterItem(null), "");
});

test("stringifyFrontmatterItem undefined returns empty string", () => {
  assert.strictEqual(stringifyFrontmatterItem(undefined), "");
});

test("stringifyFrontmatterItem flat object renders as key: value pairs", () => {
  // Regression: naive String({id:'T01', title:'X'}) was '[object Object]'.
  const result = stringifyFrontmatterItem({ id: "T01", title: "Scaffold" });
  assert.strictEqual(result, "id: T01, title: Scaffold");
});

test("stringifyFrontmatterItem object with nested object stringifies the nested as JSON", () => {
  const result = stringifyFrontmatterItem({ id: "T01", nested: { a: 1 } });
  assert.ok(result.includes("id: T01"), `result should mention id: T01, got: ${result}`);
  assert.ok(result.includes('nested: {"a":1}'), `result should render nested as JSON, got: ${result}`);
});

test("stringifyFrontmatterItem object skips null/undefined values", () => {
  const result = stringifyFrontmatterItem({ id: "T01", title: "X", note: null, extra: undefined });
  assert.strictEqual(result, "id: T01, title: X");
});

test("stringifyFrontmatterItem empty object returns empty string", () => {
  assert.strictEqual(stringifyFrontmatterItem({}), "");
});

// ─── formatValue — Array / Object branches (regression: array-of-objects frontmatter) ──

test("formatValue with array of objects returns { items: [...] } (regression: tasks frontmatter)", () => {
  // Regression: Phase Plan frontmatter `tasks: [{id, title}, ...]` was rendered
  // as `[object Object],[object Object]` because formatValue used String() directly.
  const result = formatValue("tasks", [
    { id: "T01", title: "Scaffold" },
    { id: "T02", title: "Wire up" },
  ]);
  assert.deepStrictEqual(result.items, [
    "id: T01, title: Scaffold",
    "id: T02, title: Wire up",
  ]);
  assert.strictEqual(result.text, undefined);
});

test("formatValue with array of primitives returns { items: [...] }", () => {
  const result = formatValue("repos", ["fake-api", "fake-ui"]);
  assert.deepStrictEqual(result.items, ["fake-api", "fake-ui"]);
});

test("formatValue renders a task complexity signal as plain text", () => {
  const result = formatValue("complexity", "simple");
  assert.strictEqual(result.text, "simple");
  assert.strictEqual(result.items, undefined);
});

test("formatValue with empty array returns { items: [] }", () => {
  const result = formatValue("tasks", []);
  assert.deepStrictEqual(result.items, []);
});

test("formatValue with plain object returns { text } (key: value pairs)", () => {
  const result = formatValue("meta", { a: 1, b: "x" });
  assert.strictEqual(result.text, "a: 1, b: x");
  assert.strictEqual(result.items, undefined);
});

test("formatValue with primitive string returns { text }", () => {
  const result = formatValue("project", "ITER5-E2E-SMOKE");
  assert.strictEqual(result.text, "ITER5-E2E-SMOKE");
  assert.strictEqual(result.items, undefined);
});

test("formatValue status value carries className for color", () => {
  const result = formatValue("status", "failed");
  assert.strictEqual(result.text, "failed");
  assert.ok(result.className?.includes("red"), `expected red className, got ${result.className}`);
});

test("formatValue date key formats a valid ISO date", () => {
  const result = formatValue("created", "2026-04-19T00:00:00.000Z");
  assert.ok(result.text && result.text !== "2026-04-19T00:00:00.000Z", "date should be formatted");
});

// ─── formatValue / stringifyFrontmatterItem — Date instance handling ────────
// YAML timestamps are parsed by gray-matter / js-yaml into Date objects, not
// strings. Prior code fell through to the typeof === "object" branch and
// rendered the field as an empty string via Object.entries(dateInstance) → [].

test("formatValue with Date instance for date key returns a non-ISO text", () => {
  const d = new Date("2026-04-19T00:00:00.000Z");
  const result = formatValue("created", d);
  assert.ok(result.text, `expected text, got ${JSON.stringify(result)}`);
  assert.notStrictEqual(result.text, "", "text should not be empty");
  assert.ok(result.text !== d.toISOString(), `expected non-ISO formatted date, got ${result.text}`);
});

test("formatValue with Date instance for non-date key still renders readably (not empty)", () => {
  const d = new Date("2026-04-19T00:00:00.000Z");
  const result = formatValue("arbitrary_ts", d);
  assert.ok(result.text, `expected text, got ${JSON.stringify(result)}`);
  assert.notStrictEqual(result.text, "", "non-date key with Date value should still render text");
  assert.strictEqual(result.items, undefined);
});

test("formatValue with invalid Date falls back to empty string (graceful)", () => {
  const d = new Date("garbage");
  const result = formatValue("created", d);
  assert.strictEqual(result.text, "");
});

test("stringifyFrontmatterItem with Date instance returns non-empty readable string", () => {
  const d = new Date("2026-04-19T00:00:00.000Z");
  const result = stringifyFrontmatterItem(d);
  assert.notStrictEqual(result, "", "Date should render as non-empty string, not fall through to Object.entries");
  assert.ok(result.length > 0);
});

test("stringifyFrontmatterItem with invalid Date returns empty string", () => {
  const d = new Date("garbage");
  assert.strictEqual(stringifyFrontmatterItem(d), "");
});

test("stringifyFrontmatterItem with Date nested inside an object renders sanely", () => {
  const d = new Date("2026-04-19T00:00:00.000Z");
  const result = stringifyFrontmatterItem({ id: "T01", when: d });
  assert.ok(result.includes("id: T01"), `expected id: T01 in ${result}`);
  assert.ok(result.includes("when: "), `expected when: <date> in ${result}`);
  assert.ok(!result.includes("when: [object"), `nested Date should not render as [object Object], got ${result}`);
  assert.ok(!result.includes('when: ""') && !/when:\s*(,|$)/.test(result), `nested Date should not render empty, got ${result}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
