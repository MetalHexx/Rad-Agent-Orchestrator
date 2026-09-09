/**
 * Tests for STATE_PRESENTATION — the only remaining local table for project
 * state badges, and it holds colour and motion, never words (those live in
 * `@rad-orchestration/work-graph#PROJECT_STATE_LABELS`).
 * Run with: npx tsx ui/components/badges/project-state-presentation.test.ts
 */
import assert from 'node:assert';
import { PROJECT_STATES } from '@rad-orchestration/work-graph';
import type { ProjectState } from '@rad-orchestration/work-graph';
import { STATE_PRESENTATION } from './project-state-presentation';

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

console.log('\nSTATE_PRESENTATION\n');

test('STATE_PRESENTATION has exactly one entry per PROJECT_STATES member — no gaps, no extras', () => {
  const tableKeys = Object.keys(STATE_PRESENTATION).sort();
  const stateKeys = [...PROJECT_STATES].sort();
  assert.deepStrictEqual(tableKeys, stateKeys);
});

test('isSpinning is true for exactly "planning" and "executing"', () => {
  const spinning = (Object.keys(STATE_PRESENTATION) as ProjectState[])
    .filter((s) => STATE_PRESENTATION[s].isSpinning)
    .sort();
  assert.deepStrictEqual(spinning, ['executing', 'planning']);
});

test('every entry names a --tier-* CSS custom property', () => {
  for (const state of PROJECT_STATES) {
    assert.ok(
      STATE_PRESENTATION[state].cssVar.startsWith('--tier-'),
      `${state} → "${STATE_PRESENTATION[state].cssVar}" does not start with --tier-`,
    );
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
