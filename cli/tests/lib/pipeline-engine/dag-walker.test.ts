import { describe, it, expect } from 'vitest';
import { walkDAG, deriveCurrentNodePathFromMarkers } from '../../../src/lib/pipeline-engine/dag-walker.js';
import { NODE_STATUSES } from '../../../src/lib/pipeline-engine/constants.js';
import type { PipelineState, PipelineTemplate, OrchestrationConfig, StepNodeDef, StepNodeState, ForEachPhaseNodeDef, ForEachTaskNodeDef, ForEachPhaseNodeState } from '../../../src/lib/pipeline-engine/types.js';

const CFG: OrchestrationConfig = {
  limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
  human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true },
  source_control: { auto_commit: 'never', auto_pr: 'never' },
  default_template: 't',
};

function makeFlatTwoStepTemplate(): PipelineTemplate {
  return {
    template: { id: 't', version: '1.0.0', description: 'd' },
    nodes: [
      { id: 'a', kind: 'step', label: 'A', action: 'do_a', events: { completed: 'a_done' }, depends_on: [] } as StepNodeDef,
      { id: 'b', kind: 'step', label: 'B', action: 'do_b', events: { completed: 'b_done' }, depends_on: ['a'] } as StepNodeDef,
    ],
  } as PipelineTemplate;
}

function makeStateWithStatuses(a: string, b: string): PipelineState {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'p', created: 'x', updated: 'x' },
    config: { gate_mode: 'task', limits: CFG.limits, source_control: { auto_commit: 'never', auto_pr: 'never' } },
    pipeline: { gate_mode: null, source_control: null, current_tier: 'planning', halt_reason: null },
    graph: {
      template_id: 't',
      status: 'in_progress',
      current_node_path: null,
      nodes: {
        a: { kind: 'step', status: a, doc_path: null, retries: 0 } as StepNodeState,
        b: { kind: 'step', status: b, doc_path: null, retries: 0 } as StepNodeState,
      },
    },
  } as PipelineState;
}

function makeUnseededPhaseLoop(): { tpl: PipelineTemplate; st: PipelineState; readDoc: (p: string) => { frontmatter: Record<string, unknown> } | null } {
  const taskStepDef: StepNodeDef = {
    id: 'task_executor',
    kind: 'step',
    label: 'Execute Task',
    action: 'execute_task',
    events: { completed: 'task_completed' },
    depends_on: [],
  };
  const taskLoopDef: ForEachTaskNodeDef = {
    id: 'task_loop',
    kind: 'for_each_task',
    source_doc_ref: '$.nodes.phase_plan.doc_path',
    tasks_field: 'tasks',
    body: [taskStepDef],
    depends_on: [],
  };
  const phaseLoopDef: ForEachPhaseNodeDef = {
    id: 'phase_loop',
    kind: 'for_each_phase',
    source_doc_ref: '$.nodes.master_plan.doc_path',
    total_field: 'total_phases',
    body: [taskLoopDef],
    depends_on: [],
  };

  const tpl: PipelineTemplate = {
    template: { id: 't-phase', version: '1.0.0', description: 'phase loop test' },
    nodes: [phaseLoopDef],
  };

  // State with empty iterations — walker expands via readDocument (non-explosion path)
  const st: PipelineState = {
    $schema: 'orchestration-state-v6',
    project: { name: 'p', created: 'x', updated: 'x' },
    config: {
      gate_mode: 'task',
      limits: CFG.limits,
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: null, source_control: null, current_tier: 'planning', halt_reason: null },
    graph: {
      template_id: 't-phase',
      status: 'in_progress',
      current_node_path: null,
      nodes: {
        master_plan: { kind: 'step', status: 'completed', doc_path: 'master_plan.md', retries: 0 } as StepNodeState,
        phase_plan: { kind: 'step', status: 'completed', doc_path: 'phase1/phase_plan.md', retries: 0 } as StepNodeState,
        phase_loop: {
          kind: 'for_each_phase',
          status: 'not_started',
          iterations: [],  // empty — triggers walker-driven expansion
        } as ForEachPhaseNodeState,
      },
    },
  };

  // readDocument stub: master_plan.md returns total_phases=1; phase_plan.md returns tasks=[{}]
  const readDoc = (docPath: string): { frontmatter: Record<string, unknown> } | null => {
    if (docPath.includes('master_plan')) return { frontmatter: { total_phases: 1 } };
    if (docPath.includes('phase_plan') || docPath.includes('phase1')) return { frontmatter: { tasks: [{}] } };
    return null;
  };

  return { tpl, st, readDoc };
}

describe('walkNodes step in_progress mutation', () => {
  it('flips a not_started step node to in_progress on the same walk that returns its action', () => {
    const tpl = makeFlatTwoStepTemplate();
    const st = makeStateWithStatuses('not_started', 'not_started');
    const r = walkDAG(st, tpl, CFG);
    expect(r?.action).toBe('do_a');
    expect(st.graph.nodes['a']!.status).toBe(NODE_STATUSES.IN_PROGRESS);
    expect(st.graph.nodes['b']!.status).toBe(NODE_STATUSES.NOT_STARTED);
  });

  it('is idempotent on the in_progress re-emit arm', () => {
    const tpl = makeFlatTwoStepTemplate();
    const st = makeStateWithStatuses('in_progress', 'not_started');
    const r = walkDAG(st, tpl, CFG);
    expect(r?.action).toBe('do_a');
    expect(st.graph.nodes['a']!.status).toBe(NODE_STATUSES.IN_PROGRESS);
  });

  it('does not mutate gate, conditional, or for_each container statuses on the step path', () => {
    const tpl = makeFlatTwoStepTemplate();
    const st = makeStateWithStatuses('not_started', 'not_started');
    walkDAG(st, tpl, CFG);
    // b is still not_started; only the resolved step (a) was flipped.
    expect(st.graph.nodes['b']!.status).toBe(NODE_STATUSES.NOT_STARTED);
  });
});

describe('for_each_phase / for_each_task iteration entry shape (FR-27, AD-4)', () => {
  it('seeds expanded iteration entries with a repos[] array, not commit_hash (FR-27, AD-4)', () => {
    const { tpl, st, readDoc } = makeUnseededPhaseLoop();
    walkDAG(st, tpl, CFG, readDoc);
    const phaseLoop = st.graph.nodes['phase_loop'];
    expect(phaseLoop.kind).toBe('for_each_phase');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phaseEntry = (phaseLoop as any).iterations[0];
    expect(Array.isArray(phaseEntry.repos)).toBe(true);
    expect('commit_hash' in phaseEntry).toBe(false);
    const taskEntry = phaseEntry.nodes.task_loop.iterations[0];
    expect(Array.isArray(taskEntry.repos)).toBe(true);
    expect('commit_hash' in taskEntry).toBe(false);
  });
});

describe('deriveCurrentNodePathFromMarkers — conditional / parallel are not concrete leaves', () => {
  // In the runtime templates, `pr_gate` (a conditional) stays in_progress while
  // its taken-branch step `final_pr` is in_progress. The branch step is
  // scaffolded as a FLAT SIBLING in the same nodes record and is ordered after
  // the gate. The derived cursor must name the concrete active step, not the
  // conditional router that precedes it in scan order.
  function stateWithActivePrUnderConditional(): PipelineState {
    return {
      graph: {
        status: 'in_progress',
        current_node_path: null,
        nodes: {
          // A completed phase_loop satisfies the derive guard (it requires a
          // phase_loop with >=1 iteration) without offering an in_progress leaf.
          phase_loop: {
            kind: 'for_each_phase',
            status: 'completed',
            iterations: [
              { index: 0, status: 'completed', doc_path: null, repos: [], corrective_tasks: [], nodes: {} },
            ],
          },
          final_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
          pr_gate: { kind: 'conditional', status: 'in_progress', branch_taken: 'true' },
          final_pr: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
        },
      },
    } as unknown as PipelineState;
  }

  it('returns the active branch step path, not the in_progress conditional router', () => {
    const derived = deriveCurrentNodePathFromMarkers(stateWithActivePrUnderConditional());
    expect(derived).toBe('final_pr');
  });

  it('descends into an in_progress parallel container to find the concrete leaf', () => {
    const state = {
      graph: {
        status: 'in_progress',
        current_node_path: null,
        nodes: {
          phase_loop: {
            kind: 'for_each_phase',
            status: 'in_progress',
            iterations: [
              {
                index: 0, status: 'in_progress', doc_path: null, repos: [], corrective_tasks: [],
                nodes: {
                  fan_out: {
                    kind: 'parallel',
                    status: 'in_progress',
                    nodes: {
                      leg_a: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                      leg_b: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    } as unknown as PipelineState;
    const derived = deriveCurrentNodePathFromMarkers(state);
    expect(derived).toBe('phase_loop[0].fan_out.leg_b');
  });
});
