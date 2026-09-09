import { describe, it, expect } from 'vitest';
import {
  deriveProjectState, combineProjectStates, PROJECT_STATES, PROJECT_STATE_LABELS,
} from '../src/derive/project-state.js';

const completedSteps = {
  research: { status: 'completed' }, prd: { status: 'completed' },
  requirements: { status: 'completed' }, master_plan: { status: 'completed' },
};

describe('deriveProjectState precedence', () => {
  it('reports not_initialized when there is no state or no graph object', () => {
    expect(deriveProjectState(null)).toEqual({ tier: null, state: 'not_initialized', label: 'Not Initialized' });
    expect(deriveProjectState(undefined).state).toBe('not_initialized');
    expect(deriveProjectState('nonsense').state).toBe('not_initialized');
    expect(deriveProjectState({ pipeline: { current_tier: 'execution' } }).state).toBe('not_initialized');
  });

  it('distinguishes an absent state from a planning-tier project with nothing started', () => {
    const notStarted = deriveProjectState({
      pipeline: { current_tier: 'planning' },
      graph: { status: 'not_started', nodes: { requirements: { status: 'not_started' } } },
    });
    expect(notStarted).toEqual({ tier: 'planning', state: 'not_started', label: 'Not Started' });
    expect(notStarted.state).not.toBe(deriveProjectState(null).state);
  });

  it('resolves a finished project identically from the legacy and current-engine tiers', () => {
    const legacy = deriveProjectState({
      pipeline: { current_tier: 'complete' },
      graph: { status: 'completed', nodes: { ...completedSteps, final_review: { status: 'completed' } } },
    });
    const current = deriveProjectState({
      pipeline: { current_tier: 'review' },
      graph: { status: 'completed', nodes: { ...completedSteps, final_review: { status: 'completed' } } },
    });
    expect(legacy).toEqual({ tier: 'complete', state: 'complete', label: 'Complete' });
    expect(legacy).toEqual(current);
  });

  it('reports halted from either the graph status or the active tier', () => {
    expect(deriveProjectState({
      pipeline: { current_tier: 'review' },
      graph: { status: 'halted', nodes: { phase_loop: { status: 'in_progress' } } },
    })).toEqual({ tier: 'review', state: 'halted', label: 'Halted' });
    expect(deriveProjectState({
      pipeline: { current_tier: 'halted' },
      graph: { status: 'in_progress', nodes: { phase_loop: { status: 'in_progress' } } },
    })).toEqual({ tier: 'halted', state: 'halted', label: 'Halted' });
  });

  it('runs the planning sub-branch on the planning tier', () => {
    const planning = (nodes: object, status = 'in_progress') => deriveProjectState({
      pipeline: { current_tier: 'planning' }, graph: { status, nodes },
    });
    expect(planning({}).state).toBe('not_started');
    expect(planning({ requirements: { status: 'in_progress' } }).state).toBe('planning');
    // paused at a gate between steps: no step is individually running
    expect(planning({ prd: { status: 'completed' }, requirements: { status: 'not_started' } }).state).toBe('planning');
    expect(planning(completedSteps).state).toBe('planned');
  });

  it('ignores planning steps a tier template never scaffolded', () => {
    const sparse = deriveProjectState({
      pipeline: { current_tier: 'planning' },
      graph: { status: 'in_progress', nodes: { requirements: { status: 'completed' }, master_plan: { status: 'completed' } } },
    });
    expect(sparse.state).toBe('planned');
  });

  it('runs the execution sub-branch on the execution and review tiers', () => {
    const execution = (nodes: object, tier = 'execution') => deriveProjectState({
      pipeline: { current_tier: tier }, graph: { status: 'in_progress', nodes },
    });
    expect(execution({ phase_loop: { status: 'in_progress' } })).toEqual(
      { tier: 'execution', state: 'executing', label: 'Executing' });
    expect(execution({ final_review: { status: 'in_progress' } }, 'review').state).toBe('executing');
    expect(execution({ phase_loop: { status: 'completed' } }, 'review')).toEqual(
      { tier: 'review', state: 'pending_review', label: 'Pending Review' });
  });

  it('falls back to the structural shape when the tier is unusable', () => {
    const noTier = (nodes: object) => deriveProjectState({ graph: { status: 'in_progress', nodes } });
    expect(noTier({ requirements: { status: 'in_progress' } })).toEqual(
      { tier: null, state: 'planning', label: 'Planning' });
    // planning is done, so the execution sub-branch answers instead
    expect(noTier({ ...completedSteps, phase_loop: { status: 'in_progress' } }).state).toBe('executing');
    expect(noTier({ ...completedSteps }).state).toBe('pending_review');
    // an out-of-schema tier is treated as absent, not honored
    expect(deriveProjectState({
      pipeline: { current_tier: 'complete' }, graph: { status: 'in_progress', nodes: completedSteps },
    }).tier).toBeNull();
  });
});

describe('project-state vocabulary', () => {
  it('only ever returns a member of the closed vocabulary, with its matching label', () => {
    const samples: unknown[] = [
      null, {}, { graph: { nodes: {} } },
      { pipeline: { current_tier: 'planning' }, graph: { status: 'in_progress', nodes: { prd: { status: 'in_progress' } } } },
      { pipeline: { current_tier: 'planning' }, graph: { status: 'in_progress', nodes: completedSteps } },
      { pipeline: { current_tier: 'execution' }, graph: { status: 'in_progress', nodes: { phase_loop: { status: 'in_progress' } } } },
      { pipeline: { current_tier: 'review' }, graph: { status: 'in_progress', nodes: {} } },
      { pipeline: { current_tier: 'halted' }, graph: { status: 'halted', nodes: {} } },
      { pipeline: { current_tier: 'review' }, graph: { status: 'completed', nodes: {} } },
    ];
    for (const raw of samples) {
      const { state, label } = deriveProjectState(raw);
      expect(PROJECT_STATES).toContain(state);
      expect(label).toBe(PROJECT_STATE_LABELS[state]);
    }
  });

  it('labels every member of the vocabulary', () => {
    expect(Object.keys(PROJECT_STATE_LABELS).sort()).toEqual([...PROJECT_STATES].sort());
  });
});

describe('combineProjectStates', () => {
  it('lets the highest-priority member win', () => {
    expect(combineProjectStates(['executing', 'halted', 'complete'])).toBe('halted');
    expect(combineProjectStates(['planned', 'executing'])).toBe('executing');
    expect(combineProjectStates(['not_started', 'pending_review'])).toBe('pending_review');
  });
  it('reads as complete only when every member is complete', () => {
    expect(combineProjectStates(['complete', 'complete'])).toBe('complete');
    expect(combineProjectStates(['complete', 'not_started'])).toBe('not_started');
  });
  it('reads as not_initialized with no members at all', () => {
    expect(combineProjectStates([])).toBe('not_initialized');
  });
});
