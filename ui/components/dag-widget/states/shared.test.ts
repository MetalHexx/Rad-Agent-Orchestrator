import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierTintStyle, deriveRingArc, deriveTaskNumber, parsePrLabel, deriveFinalReviewInfo, deriveFinalGatePending } from './shared';
import type { AnyProjectState, IterationEntry, NodesRecord } from '@/types/state';

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

// ─── deriveFinalReviewInfo ────────────────────────────────────────────────────

function makeStateWithNodes(nodes: NodesRecord): AnyProjectState {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'review', halt_reason: null },
    graph: { template_id: 'std', status: 'completed', current_node_path: null, nodes },
  };
}

test('deriveFinalReviewInfo reads doc_path and verdict from the top-level final_review node', () => {
  const state = makeStateWithNodes({
    final_review: { kind: 'step', status: 'completed', doc_path: 'reviews/FINAL.md', retries: 0, verdict: 'approved' },
  });
  assert.deepEqual(deriveFinalReviewInfo(state), { docPath: 'reviews/FINAL.md', verdict: 'approved' });
});

test('deriveFinalReviewInfo is null-safe when final_review is missing from the node tree', () => {
  assert.deepEqual(deriveFinalReviewInfo(makeStateWithNodes({})), { docPath: null, verdict: null });
});

test('deriveFinalReviewInfo ignores an unrelated resolved leaf (e.g. final_pr) — it always reads final_review directly', () => {
  const state = makeStateWithNodes({
    final_review: { kind: 'step', status: 'completed', doc_path: 'reviews/FINAL.md', retries: 0, verdict: 'approved' },
    final_pr: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
  });
  assert.deepEqual(deriveFinalReviewInfo(state), { docPath: 'reviews/FINAL.md', verdict: 'approved' });
});

// ─── deriveFinalGatePending ───────────────────────────────────────────────────

test('deriveFinalGatePending is true when the final_approval_gate is active and not completed', () => {
  const state = makeStateWithNodes({
    final_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
  });
  assert.equal(deriveFinalGatePending(state), true);
});

test('deriveFinalGatePending is false when the gate is not active (still at the final_review step)', () => {
  const state = makeStateWithNodes({
    final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
  });
  assert.equal(deriveFinalGatePending(state), false);
});

test('deriveFinalGatePending is false once the gate is completed (already approved), even if the flag lingers', () => {
  const state = makeStateWithNodes({
    final_approval_gate: { kind: 'gate', status: 'completed', gate_active: true },
  });
  assert.equal(deriveFinalGatePending(state), false);
});

test('deriveFinalGatePending is false when the final_approval_gate node is absent from the tree', () => {
  assert.equal(deriveFinalGatePending(makeStateWithNodes({})), false);
});
