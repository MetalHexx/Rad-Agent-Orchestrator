/**
 * Tests for KIND_PRESENTATION — the single table the sidebar list, project
 * header, and work-graph canvas node all branch on to decide whether a kind's
 * badge replaces the pipeline state badge.
 * Run with: npx tsx ui/components/badges/project-kind-presentation.test.ts
 */
import assert from 'node:assert';
import { PROJECT_KINDS } from '@rad-orchestration/work-graph';
import type { ProjectKind } from '@rad-orchestration/work-graph';
import { KIND_PRESENTATION } from './project-kind-presentation';

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

console.log('\nKIND_PRESENTATION\n');

test('KIND_PRESENTATION has exactly one entry per PROJECT_KINDS member — no gaps, no extras', () => {
  const tableKeys = Object.keys(KIND_PRESENTATION).sort();
  const kindKeys = [...PROJECT_KINDS].sort();
  assert.deepStrictEqual(tableKeys, kindKeys);
});

test('replacesStateBadge is true for exactly "portfolio"', () => {
  const replaces = (Object.keys(KIND_PRESENTATION) as ProjectKind[])
    .filter((k) => KIND_PRESENTATION[k].replacesStateBadge)
    .sort();
  assert.deepStrictEqual(replaces, ['portfolio']);
});

test('standard shows no badge at all: null label, null variant, null icon', () => {
  const standard = KIND_PRESENTATION.standard;
  assert.strictEqual(standard.label, null);
  assert.strictEqual(standard.variant, null);
  assert.strictEqual(standard.icon, null);
});

test('side-project and portfolio each carry a label, a variant, and an icon', () => {
  for (const kind of ['side-project', 'portfolio'] as ProjectKind[]) {
    const entry = KIND_PRESENTATION[kind];
    assert.ok(typeof entry.label === 'string' && entry.label.length > 0, `${kind} has no label`);
    assert.ok(entry.variant !== null, `${kind} has no variant`);
    assert.ok(entry.icon !== null, `${kind} has no icon`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
