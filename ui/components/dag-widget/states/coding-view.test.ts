import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveTaskNumber, deriveRingArc, codingView } from './coding-view';
import type { IterationEntry } from '@/types/state';

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'coding-view.tsx'), 'utf-8');

function makeIteration(overrides: Partial<IterationEntry> = {}): IterationEntry {
  return {
    index: 0,
    status: 'in_progress',
    doc_path: 'tasks/T01.md',
    corrective_tasks: [],
    repos: [{ name: 'api', commit_hash: 'abc1234' }],
    nodes: { task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
    ...overrides,
  };
}

// ─── deriveTaskNumber ─────────────────────────────────────────────────────────

test('deriveTaskNumber is 1-based from the iteration index', () => {
  assert.equal(deriveTaskNumber(makeIteration({ index: 0 })), 1);
  assert.equal(deriveTaskNumber(makeIteration({ index: 4 })), 5);
});

test('deriveTaskNumber is null when no iteration resolved', () => {
  assert.equal(deriveTaskNumber(undefined), null);
});

// ─── deriveRingArc ────────────────────────────────────────────────────────────

test('deriveRingArc passes through a valid phase progress', () => {
  assert.deepEqual(deriveRingArc({ completed: 2, total: 5 }), { value: 2, max: 5 });
});

test('deriveRingArc falls back to {0, 1} when phase progress is null', () => {
  assert.deepEqual(deriveRingArc(null), { value: 0, max: 1 });
});

test('deriveRingArc falls back to {0, 1} when total is zero (avoids a degenerate arc domain)', () => {
  assert.deepEqual(deriveRingArc({ completed: 0, total: 0 }), { value: 0, max: 1 });
});

// ─── source shape ─────────────────────────────────────────────────────────────

test('coding view id is "coding"', () => {
  assert.equal(codingView.id, 'coding');
});

test('coding view renders a commit chip', () => {
  assert.match(source, /CommitChips/);
});

test('coding view tints its doc controls to the amber execution tier', () => {
  assert.match(source, /--tier-execution/);
});

test('coding view renders the Task Handoff doc link', () => {
  assert.match(source, /label="Task Handoff"/);
});

test('coding view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});
