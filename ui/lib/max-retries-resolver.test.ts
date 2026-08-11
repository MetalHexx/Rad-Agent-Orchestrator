import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMaxRetriesPerTask,
  deriveRetryBudget,
  DEFAULT_MAX_RETRIES_PER_TASK,
} from './max-retries-resolver';
import type { AnyProjectState, CorrectiveTaskEntry } from '@/types/state';

function makeState(maxRetriesPerTask: number | undefined): AnyProjectState {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: {
        max_phases: 3,
        max_tasks_per_phase: 3,
        // A stale/hand-edited snapshot can omit this despite the required type —
        // simulate that here to exercise the documented fallback.
        max_retries_per_task: maxRetriesPerTask as unknown as number,
      },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'std', status: 'in_progress', current_node_path: null, nodes: {} },
  };
}

function makeCorrectiveEntry(overrides: Partial<CorrectiveTaskEntry> = {}): CorrectiveTaskEntry {
  return {
    index: 1,
    reason: 'code review found issues',
    injected_after: 'code_review',
    status: 'in_progress',
    doc_path: 'tasks/CORRECTIVE-1.md',
    repos: [{ name: 'api', commit_hash: 'cthash' }],
    nodes: {},
    ...overrides,
  };
}

// ─── resolveMaxRetriesPerTask ─────────────────────────────────────────────────

test('reads config.limits.max_retries_per_task when present', () => {
  assert.equal(resolveMaxRetriesPerTask(makeState(5)), 5);
});

test('DEFAULT_MAX_RETRIES_PER_TASK matches the engine/config default of 5', () => {
  assert.equal(DEFAULT_MAX_RETRIES_PER_TASK, 5);
});

test('falls back to the documented default when the snapshot omits it', () => {
  assert.equal(resolveMaxRetriesPerTask(makeState(undefined)), DEFAULT_MAX_RETRIES_PER_TASK);
});

test('treats a configured zero as valid, not missing (?? not ||)', () => {
  assert.equal(resolveMaxRetriesPerTask(makeState(0)), 0);
});

// ─── deriveRetryBudget — window-relative attempt derivation ───────────────────

test('entry index 1 with origin 0 and ceiling 2 resolves attempt 1/2', () => {
  const budget = deriveRetryBudget(makeCorrectiveEntry({ index: 1 }), makeState(2), 0);
  assert.deepEqual(budget, { attempt: 1, max: 2, label: '1/2' });
});

test('entry index 3 with origin 2 resolves to the first attempt of the new window', () => {
  const budget = deriveRetryBudget(makeCorrectiveEntry({ index: 3 }), makeState(2), 2);
  assert.equal(budget?.attempt, 1);
  assert.equal(budget?.label, '1/2');
});

test('entry index 1 with origin 2 predates the current window and returns null', () => {
  assert.equal(deriveRetryBudget(makeCorrectiveEntry({ index: 1 }), makeState(2), 2), null);
});

test('budgetOrigin defaults to 0 when omitted', () => {
  const budget = deriveRetryBudget(makeCorrectiveEntry({ index: 1 }), makeState(2));
  assert.deepEqual(budget, { attempt: 1, max: 2, label: '1/2' });
});

test('returns null when no corrective entry resolved', () => {
  assert.equal(deriveRetryBudget(undefined, makeState(2)), null);
});

test('uses the fallback ceiling in the label when the snapshot omits max_retries_per_task', () => {
  const budget = deriveRetryBudget(makeCorrectiveEntry({ index: 1 }), makeState(undefined));
  assert.equal(budget?.max, DEFAULT_MAX_RETRIES_PER_TASK);
  assert.equal(budget?.label, `1/${DEFAULT_MAX_RETRIES_PER_TASK}`);
});

test('a configured ceiling of zero survives into the budget (not treated as missing)', () => {
  const budget = deriveRetryBudget(makeCorrectiveEntry({ index: 1 }), makeState(0));
  assert.deepEqual(budget, { attempt: 1, max: 0, label: '1/0' });
});
