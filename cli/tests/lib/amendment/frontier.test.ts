import { describe, it, expect } from 'vitest';
import { computeFrontier } from '../../../src/lib/amendment/frontier.js';
import type { Frontier, PhaseIteration, PipelineState, TaskIteration } from '../../../src/lib/amendment/frontier.js';
import type { ParsedMasterPlan } from '../../../src/lib/explode-master-plan.js';

/** A task fixture: bare status, or a status plus the `repos[]` the frontier reads. */
type TaskSpec = string | { status: string; repos?: TaskIteration['repos'] };

function phaseIteration(
  index: number,
  status: string,
  tasks: TaskSpec[],
  extraNodes: Record<string, { kind?: string; status?: string }> = {},
): PhaseIteration {
  return {
    index,
    status,
    doc_path: null,
    nodes: {
      task_loop: {
        kind: 'for_each_task',
        status,
        iterations: tasks.map((task, i) => ({
          index: i,
          doc_path: null,
          ...(typeof task === 'string' ? { status: task } : task),
        })),
      },
      ...extraNodes,
    },
  };
}

function makeState(
  phases: PhaseIteration[],
  opts: { finalReviewStatus?: string; haltReason?: string | null } = {},
): PipelineState {
  return {
    graph: {
      nodes: {
        master_plan: { kind: 'step', status: 'completed', doc_path: 'MP.md' },
        phase_loop: { kind: 'for_each_phase', status: 'in_progress', iterations: phases },
        final_review: { kind: 'step', status: opts.finalReviewStatus ?? 'not_started', doc_path: null },
      },
    },
    pipeline: { gate_mode: 'task', current_tier: 'medium', halt_reason: opts.haltReason ?? null },
  };
}

/** A parsed plan whose phases carry exactly the given task ids, in order. */
function planOf(phases: string[][]): ParsedMasterPlan {
  return {
    phases: phases.map((ids, p) => ({
      id: `P${String(p + 1).padStart(2, '0')}`,
      index: p + 1,
      title: 'Phase',
      body: '',
      startLine: 0,
      tasks: ids.map((id, t) => ({
        id,
        phaseIndex: p + 1,
        taskIndex: t + 1,
        title: 'Task',
        complexity: 'standard' as const,
        purpose: '',
        targetRepos: [],
        body: '',
        startLine: 0,
      })),
    })),
    frontmatter: {},
    preamble: '',
  };
}

/** A plan holding no phase at all, so every task key falls back to positional synthesis. */
const NO_PLAN = planOf([]);

/** The frontier of a state, read against the positional fallback unless a plan is given. */
function frontierOf(state: PipelineState, plan: ParsedMasterPlan = NO_PLAN): Frontier {
  return computeFrontier(state, plan);
}

describe('computeFrontier — the frozen/editable rule', () => {
  const state = makeState([
    phaseIteration(0, 'completed', ['completed', 'completed']),
    phaseIteration(1, 'in_progress', [
      'completed',
      { status: 'in_progress', repos: [{ name: 'alpha', commit_hash: 'abc123' }] },
      'not_started',
      { status: 'in_progress' },
    ]),
    phaseIteration(2, 'not_started', ['not_started']),
  ]);
  const frontier = frontierOf(state);

  it('freezes a completed phase brief and every task beneath it', () => {
    expect(frontier.phaseBriefEditable.get(1)).toBe(false);
    expect(frontier.taskEditable.get('P01-T01')).toBe(false);
    expect(frontier.taskEditable.get('P01-T02')).toBe(false);
  });

  it('keeps a running phase brief editable', () => {
    expect(frontier.phaseBriefEditable.get(2)).toBe(true);
  });

  it('freezes a completed task and a running task with landed work, but not a pending one', () => {
    expect(frontier.taskEditable.get('P02-T01')).toBe(false);
    expect(frontier.taskEditable.get('P02-T02')).toBe(false);
    expect(frontier.taskEditable.get('P02-T03')).toBe(true);
  });

  it('keeps a running task with nothing landed editable', () => {
    expect(frontier.taskEditable.get('P02-T04')).toBe(true);
  });

  it('leaves a not-started phase and its tasks editable', () => {
    expect(frontier.phaseBriefEditable.get(3)).toBe(true);
    expect(frontier.taskEditable.get('P03-T01')).toBe(true);
  });

  it('reports the lowest editable phase as the insertion floor', () => {
    expect(frontier.firstEditablePhase).toBe(2);
  });

  it('freezes skipped and failed phase briefs alongside completed ones', () => {
    const mixed = frontierOf(makeState([
      phaseIteration(0, 'skipped', ['skipped']),
      phaseIteration(1, 'failed', ['failed']),
    ]));
    expect(mixed.phaseBriefEditable.get(1)).toBe(false);
    expect(mixed.phaseBriefEditable.get(2)).toBe(false);
    expect(mixed.firstEditablePhase).toBeNull();
  });

  it('reports no insertion floor when the plan has no phase iterations at all', () => {
    const empty = frontierOf(makeState([]));
    expect(empty.firstEditablePhase).toBeNull();
    expect(empty.phaseBriefEditable.size).toBe(0);
    expect(empty.taskEditable.size).toBe(0);
  });
});

describe('computeFrontier — a running task freezes on landed work, not on activation', () => {
  const editabilityOf = (task: TaskSpec): boolean | undefined =>
    frontierOf(makeState([phaseIteration(0, 'in_progress', [task])])).taskEditable.get('P01-T01');

  it('keeps the walker-just-arrived shape editable — a repo entry with a null hash', () => {
    expect(editabilityOf({ status: 'in_progress', repos: [{ name: 'alpha', commit_hash: null }] })).toBe(true);
  });

  it('keeps a running task with several repos and no hashes editable', () => {
    expect(editabilityOf({
      status: 'in_progress',
      repos: [{ name: 'alpha', commit_hash: null }, { name: 'beta', commit_hash: null }],
    })).toBe(true);
  });

  it('freezes a running task as soon as any one repo carries a hash', () => {
    expect(editabilityOf({
      status: 'in_progress',
      repos: [{ name: 'alpha', commit_hash: null }, { name: 'beta', commit_hash: 'def456' }],
    })).toBe(false);
  });

  it('freezes a terminal task regardless of its repo hashes', () => {
    for (const status of ['completed', 'skipped', 'halted', 'failed']) {
      expect(editabilityOf({ status, repos: [{ name: 'alpha', commit_hash: null }] })).toBe(false);
      expect(editabilityOf({ status, repos: [] })).toBe(false);
    }
  });

  it('keeps a not-started task editable regardless of its repo hashes', () => {
    expect(editabilityOf({ status: 'not_started', repos: [{ name: 'alpha', commit_hash: null }] })).toBe(true);
  });
});

describe('computeFrontier — task keys read off the plan, not off the position', () => {
  const state = makeState([
    phaseIteration(0, 'completed', ['completed']),
    phaseIteration(1, 'in_progress', ['completed', 'not_started']),
  ]);

  it('keys a phase’s tasks by the ids the plan gives them, however it numbers them', () => {
    const frontier = frontierOf(state, planOf([['P01-T01'], ['P02-T02', 'P02-T03']]));

    expect(frontier.taskEditable.get('P02-T02')).toBe(false);
    expect(frontier.taskEditable.get('P02-T03')).toBe(true);
    expect(frontier.taskFrozenReason.get('P02-T02')).toBe('completed');
    expect(frontier.taskEditable.has('P02-T01')).toBe(false);
  });

  it('falls back to the positional id where the plan holds no task at that position', () => {
    const frontier = frontierOf(state, planOf([['P01-T01'], []]));

    expect(frontier.taskEditable.get('P02-T01')).toBe(false);
    expect(frontier.taskEditable.get('P02-T02')).toBe(true);
  });

  it('keys the phase-brief maps by index regardless of the plan', () => {
    const frontier = frontierOf(state, planOf([['P01-T01'], ['P02-T02', 'P02-T03']]));

    expect(frontier.phaseBriefEditable.get(1)).toBe(false);
    expect(frontier.phaseBriefEditable.get(2)).toBe(true);
    expect(frontier.firstEditablePhase).toBe(2);
  });
});

describe('computeFrontier — upstream halt detection', () => {
  it('flags a halted phase iteration and carries the pipeline halt reason', () => {
    const frontier = frontierOf(makeState(
      [phaseIteration(0, 'completed', ['completed']), phaseIteration(1, 'halted', ['completed'])],
      { haltReason: 'phase review found a blocker' },
    ));
    expect(frontier.upstreamHalt).toEqual({ node: 'phase_loop[1]', reason: 'phase review found a blocker' });
  });

  it('flags a halted task iteration', () => {
    const frontier = frontierOf(makeState(
      [phaseIteration(0, 'in_progress', ['completed', 'halted'])],
      { haltReason: 'retry budget exhausted' },
    ));
    expect(frontier.upstreamHalt?.node).toBe('phase_loop[0].task_loop[1]');
    expect(frontier.upstreamHalt?.reason).toBe('retry budget exhausted');
  });

  it('flags a halted in-loop node', () => {
    const frontier = frontierOf(makeState([
      phaseIteration(0, 'in_progress', ['completed'], { phase_review: { kind: 'step', status: 'halted' } }),
    ]));
    expect(frontier.upstreamHalt?.node).toBe('phase_loop[0].phase_review');
  });

  it('does NOT flag a halt sitting on the final review step', () => {
    const frontier = frontierOf(makeState(
      [phaseIteration(0, 'completed', ['completed'])],
      { finalReviewStatus: 'halted', haltReason: 'final review halted the run' },
    ));
    expect(frontier.upstreamHalt).toBeNull();
  });

  it('reports no halt on a healthy run', () => {
    const frontier = frontierOf(makeState([phaseIteration(0, 'in_progress', ['not_started'])]));
    expect(frontier.upstreamHalt).toBeNull();
  });
});

describe('computeFrontier — the frozen-reason maps', () => {
  it('names each terminal task status as its own reason, and leaves a not-started task absent', () => {
    const frontier = frontierOf(makeState([
      phaseIteration(0, 'completed', ['completed', 'skipped', 'halted', 'failed', 'not_started']),
    ]));
    expect(frontier.taskFrozenReason.get('P01-T01')).toBe('completed');
    expect(frontier.taskFrozenReason.get('P01-T02')).toBe('skipped');
    expect(frontier.taskFrozenReason.get('P01-T03')).toBe('halted');
    expect(frontier.taskFrozenReason.get('P01-T04')).toBe('failed');
    expect(frontier.taskFrozenReason.has('P01-T05')).toBe(false);
  });

  it('names the committed repo(s) as the reason for a running task with landed work', () => {
    const frontier = frontierOf(makeState([
      phaseIteration(0, 'in_progress', [
        { status: 'in_progress', repos: [{ name: 'alpha', commit_hash: null }, { name: 'beta', commit_hash: 'abc123' }] },
      ]),
    ]));
    expect(frontier.taskFrozenReason.get('P01-T01')).toBe('in progress with work committed to beta');
  });

  it('leaves a running task with nothing landed absent from the reason map', () => {
    const frontier = frontierOf(makeState([
      phaseIteration(0, 'in_progress', [{ status: 'in_progress', repos: [{ name: 'alpha', commit_hash: null }] }]),
    ]));
    expect(frontier.taskFrozenReason.has('P01-T01')).toBe(false);
  });

  it('names each terminal phase status as its own reason, and leaves an editable phase absent', () => {
    const frontier = frontierOf(makeState([
      phaseIteration(0, 'completed', ['completed']),
      phaseIteration(1, 'skipped', ['skipped']),
      phaseIteration(2, 'halted', ['halted']),
      phaseIteration(3, 'failed', ['failed']),
      phaseIteration(4, 'not_started', ['not_started']),
      phaseIteration(5, 'in_progress', ['not_started']),
    ]));
    expect(frontier.phaseFrozenReason.get(1)).toBe('completed');
    expect(frontier.phaseFrozenReason.get(2)).toBe('skipped');
    expect(frontier.phaseFrozenReason.get(3)).toBe('halted');
    expect(frontier.phaseFrozenReason.get(4)).toBe('failed');
    expect(frontier.phaseFrozenReason.has(5)).toBe(false);
    expect(frontier.phaseFrozenReason.has(6)).toBe(false);
  });
});
