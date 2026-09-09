/**
 * Confirms an amendment clearing a halt needs no bespoke branch in the
 * project-state derivation: `deriveProjectState` (owned by
 * `@rad-orchestration/work-graph`) already reads the generic graph/tier shape,
 * so a halt raised at final scope and a halt resumed by an amendment resolve
 * through the same precedence rules every other halt/resume already uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveProjectState } from '@rad-orchestration/work-graph';

const haltedAtFinalScope = {
  pipeline: { current_tier: 'review', halt_reason: 'Final review requested changes' },
  graph: {
    status: 'halted',
    nodes: {
      phase_loop: { status: 'completed' },
      final_review: { status: 'halted' },
    },
  },
};

const amendmentClearedExecuting = {
  pipeline: { current_tier: 'execution', halt_reason: null },
  graph: {
    status: 'in_progress',
    nodes: {
      phase_loop: { status: 'in_progress' },
      final_review: { status: 'not_started' },
    },
  },
};

test('a project halted at final scope renders halted', () => {
  const derived = deriveProjectState(haltedAtFinalScope);
  assert.equal(derived.state, 'halted');
  assert.equal(derived.label, 'Halted');
});

test('after an amendment clears the halt and resumes phase execution, the project renders executing', () => {
  const derived = deriveProjectState(amendmentClearedExecuting);
  assert.equal(derived.state, 'executing');
  assert.equal(derived.label, 'Executing');
});

test('the two fixtures resolve to distinct states — resuming genuinely leaves the halted state behind', () => {
  const halted = deriveProjectState(haltedAtFinalScope);
  const resumed = deriveProjectState(amendmentClearedExecuting);
  assert.notEqual(halted.state, resumed.state);
});
