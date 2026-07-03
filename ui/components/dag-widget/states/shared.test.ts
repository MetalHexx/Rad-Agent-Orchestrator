import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierTintStyle, deriveRingArc, deriveTaskNumber, parsePrLabel } from './shared';
import type { IterationEntry } from '@/types/state';

function makeIteration(overrides: Partial<IterationEntry> = {}): IterationEntry {
  return {
    index: 0,
    status: 'in_progress',
    doc_path: 'tasks/T01.md',
    corrective_tasks: [],
    repos: [],
    nodes: {},
    ...overrides,
  };
}

// ─── tierTintStyle ────────────────────────────────────────────────────────────

test('tierTintStyle overrides --primary with the given tier var', () => {
  assert.deepEqual(tierTintStyle('--tier-execution'), { '--primary': 'var(--tier-execution)' });
  assert.deepEqual(tierTintStyle('--status-failed'), { '--primary': 'var(--status-failed)' });
});

// ─── deriveRingArc ────────────────────────────────────────────────────────────

test('deriveRingArc passes through a valid progress pair', () => {
  assert.deepEqual(deriveRingArc({ completed: 2, total: 5 }), { value: 2, max: 5 });
});

test('deriveRingArc falls back to {0, 1} when progress is null', () => {
  assert.deepEqual(deriveRingArc(null), { value: 0, max: 1 });
});

test('deriveRingArc falls back to {0, 1} when total is zero (avoids a degenerate arc domain)', () => {
  assert.deepEqual(deriveRingArc({ completed: 0, total: 0 }), { value: 0, max: 1 });
});

// ─── deriveTaskNumber ─────────────────────────────────────────────────────────

test('deriveTaskNumber is 1-based from the iteration index', () => {
  assert.equal(deriveTaskNumber(makeIteration({ index: 0 })), 1);
  assert.equal(deriveTaskNumber(makeIteration({ index: 4 })), 5);
});

test('deriveTaskNumber is null when no iteration resolved', () => {
  assert.equal(deriveTaskNumber(undefined), null);
});

// ─── parsePrLabel ─────────────────────────────────────────────────────────────

test('parsePrLabel extracts the PR number from a GitHub pull URL', () => {
  assert.equal(parsePrLabel('https://github.com/o/r/pull/42'), 'PR #42');
});

test('parsePrLabel falls back to a bare "PR" when no number is present', () => {
  assert.equal(parsePrLabel('https://example.com/not-a-pull-url'), 'PR');
});
