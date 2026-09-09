import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNodeDTO, KNOWN_TIERS } from './work-graph-dto';
import type { Node, Project, ProjectState, Tier } from '@rad-orchestration/work-graph';

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    kind: 'project',
    name: 'Project One',
    status: 'in_progress',
    state: 'executing',
    stateLabel: 'Executing',
    dir: '/tmp/proj-1',
    tier: 'execution',
    projectType: 'standard',
    sourceControlInitialized: false,
    docs: { others: [], subfolders: [] },
    worktrees: [],
    haltReason: null,
    ...overrides,
  };
}

const CANONICAL_STATES: { state: ProjectState; stateLabel: string; tier: Tier | null }[] = [
  { state: 'not_initialized', stateLabel: 'Not Initialized', tier: null },
  { state: 'not_started', stateLabel: 'Not Started', tier: 'planning' },
  { state: 'planning', stateLabel: 'Planning', tier: 'planning' },
  { state: 'planned', stateLabel: 'Planned', tier: 'planning' },
  { state: 'executing', stateLabel: 'Executing', tier: 'execution' },
  { state: 'pending_review', stateLabel: 'Pending Review', tier: 'review' },
  { state: 'halted', stateLabel: 'Halted', tier: 'halted' },
  { state: 'complete', stateLabel: 'Complete', tier: 'complete' },
];

for (const { state, stateLabel, tier } of CANONICAL_STATES) {
  test(`a project node carrying state "${state}" produces a DTO carrying the matching state, stateLabel, and tier`, () => {
    const project = buildProject({ state, stateLabel, tier });
    const dto = toNodeDTO(project);
    assert.deepEqual(dto, {
      id: 'proj-1', kind: 'project', name: 'Project One', tier, state, stateLabel, projectType: 'standard',
    });
  });
}

test('a project\'s projectType passes straight through to the DTO, whatever kind it carries', () => {
  const project = buildProject({ projectType: 'portfolio' });
  const dto = toNodeDTO(project);
  assert.deepEqual(dto, {
    id: 'proj-1', kind: 'project', name: 'Project One', tier: 'execution', state: 'executing',
    stateLabel: 'Executing', projectType: 'portfolio',
  });
});

test('a project whose tier falls outside KNOWN_TIERS yields tier: null while keeping its state intact', () => {
  const project = buildProject({
    tier: 'unknown-future-tier' as unknown as Tier,
    state: 'executing',
    stateLabel: 'Executing',
  });
  const dto = toNodeDTO(project);
  assert.equal(dto.kind, 'project');
  assert.deepEqual(dto, {
    id: 'proj-1', kind: 'project', name: 'Project One', tier: null, state: 'executing', stateLabel: 'Executing',
    projectType: 'standard',
  });
});

test('a project with an already-null tier still passes its state through unchanged', () => {
  const project = buildProject({ tier: null, state: 'not_initialized', stateLabel: 'Not Initialized' });
  const dto = toNodeDTO(project);
  assert.deepEqual(dto, {
    id: 'proj-1', kind: 'project', name: 'Project One', tier: null, state: 'not_initialized', stateLabel: 'Not Initialized',
    projectType: 'standard',
  });
});

test('a group node maps to a bare {id, kind, name} DTO, dropping state entirely', () => {
  const group: Node = {
    id: 'group-1', kind: 'group', name: 'Group One', status: 'in_progress',
    state: 'executing', stateLabel: 'Executing',
  };
  const dto = toNodeDTO(group);
  assert.deepEqual(dto, { id: 'group-1', kind: 'group', name: 'Group One' });
});

test('KNOWN_TIERS carries exactly the five known tiers, including complete', () => {
  assert.deepEqual([...KNOWN_TIERS].sort(), ['complete', 'execution', 'halted', 'planning', 'review']);
});
