import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveTaskNumber, deriveRingArc, reviewingView } from './reviewing-view';
import type { IterationEntry } from '@/types/state';

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'reviewing-view.tsx'), 'utf-8');

function makeIteration(overrides: Partial<IterationEntry> = {}): IterationEntry {
  return {
    index: 1,
    status: 'in_progress',
    doc_path: 'tasks/T02.md',
    corrective_tasks: [],
    repos: [{ name: 'api', commit_hash: 'def5678' }],
    nodes: {
      task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      code_review: { kind: 'step', status: 'in_progress', doc_path: 'reviews/r1.md', retries: 0 },
    },
    ...overrides,
  };
}

// ─── deriveTaskNumber ─────────────────────────────────────────────────────────

test('deriveTaskNumber is 1-based from the iteration index', () => {
  assert.equal(deriveTaskNumber(makeIteration({ index: 1 })), 2);
});

test('deriveTaskNumber is null when no iteration resolved', () => {
  assert.equal(deriveTaskNumber(undefined), null);
});

// ─── deriveRingArc ────────────────────────────────────────────────────────────

test('deriveRingArc passes through a valid phase progress', () => {
  assert.deepEqual(deriveRingArc({ completed: 3, total: 4 }), { value: 3, max: 4 });
});

test('deriveRingArc falls back to {0, 1} when phase progress is null', () => {
  assert.deepEqual(deriveRingArc(null), { value: 0, max: 1 });
});

// ─── source shape ─────────────────────────────────────────────────────────────

test('reviewing view id is "reviewing"', () => {
  assert.equal(reviewingView.id, 'reviewing');
});

test('reviewing view renders a commit chip', () => {
  assert.match(source, /CommitChips/);
});

test('reviewing view tints its doc controls to the purple review tier', () => {
  assert.match(source, /--tier-review/);
});

test('reviewing view renders both the Task Handoff and Code Review doc links', () => {
  assert.match(source, /label="Task Handoff"/);
  assert.match(source, /label="Code Review"/);
});

test('reviewing view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});
