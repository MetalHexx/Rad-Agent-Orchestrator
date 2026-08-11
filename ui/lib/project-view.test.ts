import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectStateV5 } from '@/types/state';
import { selectProjectView, type ProjectViewInput } from './project-view';

function stateFor(name: string): ProjectStateV5 {
  return {
    $schema: 'orchestration-state-v5',
    project: { name, created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 5, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'std', status: 'in_progress', current_node_path: null, nodes: {} },
  };
}

/** A project whose summary says it has a plan, with nothing settled or owned yet. */
function inputFor(overrides: Partial<ProjectViewInput> = {}): ProjectViewInput {
  return {
    selectedName: 'beta',
    tier: 'execution',
    schemaVersion: 'v5',
    hasMalformedState: false,
    ownedState: null,
    ownedError: null,
    stateSettledFor: null,
    placeholderHeld: false,
    ...overrides,
  };
}

test('state owned by another project with the selected project unsettled resolves to loading, never plan', () => {
  const view = selectProjectView(inputFor({
    ownedState: { owner: 'alpha', state: stateFor('alpha') },
    stateSettledFor: 'alpha',
  }));
  assert.equal(view, 'loading');
});

test('state owned by another project is ignored even once the selected project has settled', () => {
  const view = selectProjectView(inputFor({
    ownedState: { owner: 'alpha', state: stateFor('alpha') },
    stateSettledFor: 'beta',
  }));
  assert.notEqual(view, 'plan');
  assert.equal(view, 'error', 'a summary that claims a plan with no state of its own is unreadable, not unlaunched');
});

test('state owned by the selected project and settled resolves to plan', () => {
  const view = selectProjectView(inputFor({
    ownedState: { owner: 'beta', state: stateFor('beta') },
    stateSettledFor: 'beta',
  }));
  assert.equal(view, 'plan');
});

test('settled with no state resolves to launch for an uninitialized summary', () => {
  const view = selectProjectView(inputFor({
    tier: 'not_initialized',
    schemaVersion: undefined,
    stateSettledFor: 'beta',
  }));
  assert.equal(view, 'launch');
});

test('settled with no state resolves to error for a summary that claims a plan', () => {
  const view = selectProjectView(inputFor({ stateSettledFor: 'beta' }));
  assert.equal(view, 'error');
});

test('an error owned by the selected project wins over owned settled state', () => {
  const view = selectProjectView(inputFor({
    ownedError: { owner: 'beta', message: 'boom' },
    ownedState: { owner: 'beta', state: stateFor('beta') },
    stateSettledFor: 'beta',
  }));
  assert.equal(view, 'error');
});

test('an error owned by a different project is ignored', () => {
  const view = selectProjectView(inputFor({
    ownedError: { owner: 'alpha', message: 'boom' },
    ownedState: { owner: 'beta', state: stateFor('beta') },
    stateSettledFor: 'beta',
  }));
  assert.equal(view, 'plan');
});

test('a project-list error, which owns no project, is ignored', () => {
  const view = selectProjectView(inputFor({
    ownedError: { owner: null, message: 'list failed' },
    ownedState: { owner: 'beta', state: stateFor('beta') },
    stateSettledFor: 'beta',
  }));
  assert.equal(view, 'plan');
});

test('a malformed summary resolves to error when nothing has been fetched for it yet', () => {
  const view = selectProjectView(inputFor({ hasMalformedState: true }));
  assert.equal(view, 'error');
});

test('a malformed summary is overridden by a successful, settled, owned retry', () => {
  // The malformed flag comes from the project-list summary, which Retry never
  // refetches. A settled, owner-matched state means the retry actually
  // produced a readable plan, so it must win over the stale flag rather than
  // trapping the view in 'error' forever.
  const view = selectProjectView(inputFor({
    hasMalformedState: true,
    ownedState: { owner: 'beta', state: stateFor('beta') },
    stateSettledFor: 'beta',
  }));
  assert.equal(view, 'plan');
});

test('an unsettled selected project resolves to loading rather than guessing at launch', () => {
  const view = selectProjectView(inputFor({
    tier: 'not_initialized',
    schemaVersion: undefined,
    stateSettledFor: null,
  }));
  assert.equal(view, 'loading');
});

test('the placeholder floor holds loading over an already-settled answer', () => {
  const settled = inputFor({
    ownedState: { owner: 'beta', state: stateFor('beta') },
    stateSettledFor: 'beta',
  });
  assert.equal(selectProjectView(settled), 'plan');
  assert.equal(selectProjectView({ ...settled, placeholderHeld: true }), 'loading');
});

test('an owned error outranks the placeholder floor so a failure is never hidden behind a skeleton', () => {
  const view = selectProjectView(inputFor({
    ownedError: { owner: 'beta', message: 'boom' },
    placeholderHeld: true,
  }));
  assert.equal(view, 'error');
});
