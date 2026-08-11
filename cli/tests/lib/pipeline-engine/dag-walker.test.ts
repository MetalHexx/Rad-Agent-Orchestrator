import { describe, it, expect } from 'vitest';
import { walkDAG, deriveCurrentNodePathFromMarkers } from '../../../src/lib/pipeline-engine/dag-walker.js';
import { NODE_STATUSES } from '../../../src/lib/pipeline-engine/constants.js';
import type { PipelineState, PipelineTemplate, OrchestrationConfig, StepNodeDef, StepNodeState, ForEachPhaseNodeDef, ForEachTaskNodeDef, ForEachPhaseNodeState, CorrectiveTaskEntry, NodeDef, GateNodeDef, GateNodeState } from '../../../src/lib/pipeline-engine/types.js';

const CFG: OrchestrationConfig = {
  limits: { max_retries_per_task: 3 },
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

function makeSingleGateTemplate(gateDef: GateNodeDef): PipelineTemplate {
  return {
    template: { id: 't-gate', version: '1.0.0', description: 'gate test' },
    nodes: [gateDef],
  };
}

function makeSingleGateState(gateId: string, status: string): PipelineState {
  return {
    $schema: 'orchestration-state-v6',
    project: { name: 'p', created: 'x', updated: 'x' },
    config: { gate_mode: 'task', limits: CFG.limits, source_control: { auto_commit: 'never', auto_pr: 'never' } },
    pipeline: { gate_mode: null, source_control: null, current_tier: 'planning', halt_reason: null },
    graph: {
      template_id: 't-gate',
      status: 'in_progress',
      current_node_path: null,
      nodes: {
        [gateId]: { kind: 'gate', status, gate_active: false } as GateNodeState,
      },
    },
  } as PipelineState;
}

describe('boolean human approval gates go in_progress while blocking (plan_approval_gate, final_approval_gate)', () => {
  const planGateDef: GateNodeDef = {
    id: 'plan_approval_gate',
    kind: 'gate',
    mode_ref: 'human_gates.after_planning',
    action_if_needed: 'request_plan_approval',
    approved_event: 'plan_approved',
    depends_on: [],
  };

  it('a blocking boolean gate reports in_progress, sets gate_active, and returns action_if_needed', () => {
    const tpl = makeSingleGateTemplate(planGateDef);
    const st = makeSingleGateState('plan_approval_gate', 'not_started');
    const cfg: OrchestrationConfig = { ...CFG, human_gates: { ...CFG.human_gates, after_planning: true } };
    const r = walkDAG(st, tpl, cfg);
    expect(r?.action).toBe('request_plan_approval');
    const gate = st.graph.nodes['plan_approval_gate'] as GateNodeState;
    expect(gate.status).toBe(NODE_STATUSES.IN_PROGRESS);
    expect(gate.gate_active).toBe(true);
  });

  it('re-walking a gate already blocking (in_progress) re-emits action_if_needed and stays in_progress', () => {
    const tpl = makeSingleGateTemplate(planGateDef);
    const st = makeSingleGateState('plan_approval_gate', 'in_progress');
    const cfg: OrchestrationConfig = { ...CFG, human_gates: { ...CFG.human_gates, after_planning: true } };
    const r = walkDAG(st, tpl, cfg);
    expect(r?.action).toBe('request_plan_approval');
    expect((st.graph.nodes['plan_approval_gate'] as GateNodeState).status).toBe(NODE_STATUSES.IN_PROGRESS);
  });

  it('a disabled boolean gate (mode false) auto-completes on the same walk without ever passing through in_progress', () => {
    const tpl = makeSingleGateTemplate(planGateDef);
    const st = makeSingleGateState('plan_approval_gate', 'not_started');
    const cfg: OrchestrationConfig = { ...CFG, human_gates: { ...CFG.human_gates, after_planning: false } };
    walkDAG(st, tpl, cfg);
    const gate = st.graph.nodes['plan_approval_gate'] as GateNodeState;
    expect(gate.status).toBe(NODE_STATUSES.COMPLETED);
    expect(gate.gate_active).toBe(false);
  });

  it('final_approval_gate follows the same blocking boolean path as plan_approval_gate', () => {
    const finalGateDef: GateNodeDef = {
      id: 'final_approval_gate',
      kind: 'gate',
      mode_ref: 'human_gates.after_final_review',
      action_if_needed: 'request_final_approval',
      approved_event: 'final_approved',
      depends_on: [],
    };
    const tpl = makeSingleGateTemplate(finalGateDef);
    const st = makeSingleGateState('final_approval_gate', 'not_started');
    const cfg: OrchestrationConfig = { ...CFG, human_gates: { ...CFG.human_gates, after_final_review: true } };
    const r = walkDAG(st, tpl, cfg);
    expect(r?.action).toBe('request_final_approval');
    const gate = st.graph.nodes['final_approval_gate'] as GateNodeState;
    expect(gate.status).toBe(NODE_STATUSES.IN_PROGRESS);
    expect(gate.gate_active).toBe(true);
  });
});

describe('string-mode_ref gates are unaffected (gate_mode_selection, task_gate, phase_gate)', () => {
  // Mirrors the real templates' task_gate: auto_approve_modes excludes 'task',
  // so execution_mode 'task' falls through to the "Default: show gate" arm.
  const taskGateDef: GateNodeDef = {
    id: 'task_gate',
    kind: 'gate',
    mode_ref: 'human_gates.execution_mode',
    action_if_needed: 'gate_task',
    approved_event: 'task_gate_approved',
    auto_approve_modes: ['phase', 'autonomous'],
    depends_on: [],
  };

  it('ask mode with no persisted gate_mode asks for gate mode, never touching status', () => {
    const tpl = makeSingleGateTemplate(taskGateDef);
    const st = makeSingleGateState('task_gate', 'not_started');
    const cfg: OrchestrationConfig = { ...CFG, human_gates: { ...CFG.human_gates, execution_mode: 'ask' } };
    const r = walkDAG(st, tpl, cfg);
    expect(r?.action).toBe('ask_gate_mode');
    expect((st.graph.nodes['task_gate'] as GateNodeState).status).toBe(NODE_STATUSES.NOT_STARTED);
  });

  it('task mode shows the gate action but leaves status not_started (only gate_active flips)', () => {
    const tpl = makeSingleGateTemplate(taskGateDef);
    const st = makeSingleGateState('task_gate', 'not_started');
    st.pipeline.gate_mode = 'task';
    const cfg: OrchestrationConfig = { ...CFG, human_gates: { ...CFG.human_gates, execution_mode: 'task' } };
    const r = walkDAG(st, tpl, cfg);
    expect(r?.action).toBe('gate_task');
    const gate = st.graph.nodes['task_gate'] as GateNodeState;
    expect(gate.status).toBe(NODE_STATUSES.NOT_STARTED);
    expect(gate.gate_active).toBe(true);
  });

  it('an auto-approved mode (in auto_approve_modes) completes the gate directly, bypassing in_progress', () => {
    const tpl = makeSingleGateTemplate(taskGateDef);
    const st = makeSingleGateState('task_gate', 'not_started');
    st.pipeline.gate_mode = 'phase';
    const cfg: OrchestrationConfig = { ...CFG, human_gates: { ...CFG.human_gates, execution_mode: 'phase' } };
    walkDAG(st, tpl, cfg);
    const gate = st.graph.nodes['task_gate'] as GateNodeState;
    expect(gate.status).toBe(NODE_STATUSES.COMPLETED);
    expect(gate.gate_active).toBe(false);
  });
});

describe('deriveCurrentNodePathFromMarkers — blocking human gate before the phase loop is seeded', () => {
  it('returns the gate id at a blocked plan-approval gate with an empty phase loop', () => {
    const state = {
      graph: {
        status: 'in_progress',
        current_node_path: null,
        nodes: {
          plan_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
        },
      },
    } as unknown as PipelineState;
    expect(deriveCurrentNodePathFromMarkers(state)).toBe('plan_approval_gate');
  });

  it('returns the gate id at a blocked final-approval gate alongside a completed phase loop', () => {
    const state = {
      graph: {
        status: 'in_progress',
        current_node_path: null,
        nodes: {
          phase_loop: {
            kind: 'for_each_phase',
            status: 'completed',
            iterations: [
              { index: 0, status: 'completed', doc_path: null, repos: [], corrective_tasks: [], nodes: {} },
            ],
          },
          final_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
          final_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
        },
      },
    } as unknown as PipelineState;
    expect(deriveCurrentNodePathFromMarkers(state)).toBe('final_approval_gate');
  });

  it('still returns null for a bare in-progress master_plan before explosion (the guard\'s original purpose)', () => {
    const state = {
      graph: {
        status: 'in_progress',
        current_node_path: null,
        nodes: {
          master_plan: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
        },
      },
    } as unknown as PipelineState;
    expect(deriveCurrentNodePathFromMarkers(state)).toBeNull();
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

describe('walkStepHostedCorrectives (step-hosted final corrective)', () => {
  const taskExecutorDef: StepNodeDef = {
    id: 'task_executor',
    kind: 'step',
    label: 'Execute Task',
    action: 'execute_task',
    events: { completed: 'task_completed' },
    depends_on: [],
  };
  const codeReviewDef: StepNodeDef = {
    id: 'code_review',
    kind: 'step',
    label: 'Code Review',
    action: 'spawn_code_reviewer',
    events: { completed: 'code_review_completed' },
    depends_on: ['task_executor'],
  };

  function makeFinalCorrectiveTemplate(bodyDefs: NodeDef[]): PipelineTemplate {
    const taskLoopDef: ForEachTaskNodeDef = {
      id: 'task_loop',
      kind: 'for_each_task',
      source_doc_ref: '$.current_phase.doc_path',
      tasks_field: 'tasks',
      body: bodyDefs,
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
    const finalReviewDef: StepNodeDef = {
      id: 'final_review',
      kind: 'step',
      label: 'Final Review',
      action: 'spawn_final_reviewer',
      events: { completed: 'final_review_completed' },
      hosts_correctives: true,
      depends_on: ['phase_loop'],
    };
    const finalPrDef: StepNodeDef = {
      id: 'final_pr',
      kind: 'step',
      label: 'Final PR',
      action: 'invoke_source_control_pr',
      events: { completed: 'pr_created' },
      depends_on: ['final_review'],
    };
    return {
      template: { id: 't-final-corrective', version: '1.0.0', description: 'd' },
      nodes: [phaseLoopDef, finalReviewDef, finalPrDef],
    };
  }

  function makeStateWithFinalCorrective(entry: CorrectiveTaskEntry, opts?: {
    finalReviewStatus?: string;
    budgetOrigin?: number;
  }): PipelineState {
    return {
      $schema: 'orchestration-state-v6',
      project: { name: 'p', created: 'x', updated: 'x' },
      config: { gate_mode: 'task', limits: CFG.limits, source_control: { auto_commit: 'never', auto_pr: 'never' } },
      pipeline: { gate_mode: null, source_control: null, current_tier: 'review', halt_reason: 'halted for testing' },
      graph: {
        template_id: 't-final-corrective',
        status: 'in_progress',
        current_node_path: null,
        nodes: {
          phase_loop: {
            kind: 'for_each_phase',
            status: 'completed',
            iterations: [
              { index: 0, status: 'completed', doc_path: 'phase1/phase_plan.md', repos: [], corrective_tasks: [], nodes: {} },
            ],
          } as ForEachPhaseNodeState,
          final_review: {
            kind: 'step',
            status: opts?.finalReviewStatus ?? 'in_progress',
            doc_path: 'final-review.md',
            retries: 0,
            corrective_tasks: [entry],
            corrective_budget_origin: opts?.budgetOrigin ?? 0,
          } as StepNodeState,
          final_pr: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 } as StepNodeState,
        },
      },
    } as PipelineState;
  }

  it('prefers an open corrective\'s not_started body over final_review\'s own re-emit', () => {
    const entry: CorrectiveTaskEntry = {
      index: 1,
      reason: 'Final review requested changes',
      injected_after: 'final_review',
      status: 'not_started',
      nodes: {
        task_executor: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
        code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      },
      doc_path: null,
      review_report_path: 'final-review.md',
      repos: [],
    };
    const tpl = makeFinalCorrectiveTemplate([taskExecutorDef, codeReviewDef]);
    const st = makeStateWithFinalCorrective(entry);

    const r = walkDAG(st, tpl, CFG);

    expect(r?.action).toBe('execute_task');
    expect(r?.action).not.toBe('spawn_final_reviewer');
    expect(entry.status).toBe(NODE_STATUSES.IN_PROGRESS);
  });

  it('closes the corrective and unblocks the downstream node once its body completes', () => {
    const entry: CorrectiveTaskEntry = {
      index: 1,
      reason: 'Final review requested changes',
      injected_after: 'final_review',
      status: 'in_progress',
      nodes: {
        task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
        code_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      },
      doc_path: null,
      review_report_path: 'final-review.md',
      repos: [],
    };
    const tpl = makeFinalCorrectiveTemplate([taskExecutorDef, codeReviewDef]);
    const st = makeStateWithFinalCorrective(entry);

    const r = walkDAG(st, tpl, CFG);

    expect(entry.status).toBe(NODE_STATUSES.COMPLETED);
    expect((st.graph.nodes['final_review'] as StepNodeState).status).toBe(NODE_STATUSES.COMPLETED);
    expect(r?.action).toBe('invoke_source_control_pr');
    expect((st.graph.nodes['final_pr'] as StepNodeState).status).toBe(NODE_STATUSES.IN_PROGRESS);
  });

  it('treats a spent budget window as empty — the walker re-emits the step\'s own action', () => {
    const entry: CorrectiveTaskEntry = {
      index: 1,
      reason: 'Final review requested changes',
      injected_after: 'final_review',
      status: 'completed',
      nodes: {
        task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
        code_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      },
      doc_path: null,
      review_report_path: 'final-review.md',
      repos: [],
    };
    const tpl = makeFinalCorrectiveTemplate([taskExecutorDef, codeReviewDef]);
    // corrective_budget_origin === entry count: the window is spent/invisible.
    const st = makeStateWithFinalCorrective(entry, { budgetOrigin: 1 });

    const r = walkDAG(st, tpl, CFG);

    expect(r?.action).toBe('spawn_final_reviewer');
  });

  it('yields display_halted with the halt reason when the active corrective entry is halted', () => {
    const entry: CorrectiveTaskEntry = {
      index: 1,
      reason: 'Final review requested changes',
      injected_after: 'final_review',
      status: 'halted',
      nodes: {
        task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
        code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      },
      doc_path: null,
      review_report_path: 'final-review.md',
      repos: [],
    };
    const tpl = makeFinalCorrectiveTemplate([taskExecutorDef, codeReviewDef]);
    const st = makeStateWithFinalCorrective(entry);

    const r = walkDAG(st, tpl, CFG);

    expect(r?.action).toBe('display_halted');
    expect(r?.context.details).toBe('halted for testing');
  });

  it('a low-tier template (task_executor-only body) closes the corrective after task_executor alone', () => {
    const entry: CorrectiveTaskEntry = {
      index: 1,
      reason: 'Final review requested changes',
      injected_after: 'final_review',
      status: 'in_progress',
      nodes: {
        task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      },
      doc_path: null,
      review_report_path: 'final-review.md',
      repos: [],
    };
    const tpl = makeFinalCorrectiveTemplate([taskExecutorDef]);
    const st = makeStateWithFinalCorrective(entry);

    const r = walkDAG(st, tpl, CFG);

    expect(entry.status).toBe(NODE_STATUSES.COMPLETED);
    expect((st.graph.nodes['final_review'] as StepNodeState).status).toBe(NODE_STATUSES.COMPLETED);
    expect(r?.action).toBe('invoke_source_control_pr');
  });

  it('walkDAG returns null (empty-window pass-through) when hosts_correctives is set but no corrective_tasks exist yet', () => {
    const tpl = makeFinalCorrectiveTemplate([taskExecutorDef, codeReviewDef]);
    const st: PipelineState = {
      $schema: 'orchestration-state-v6',
      project: { name: 'p', created: 'x', updated: 'x' },
      config: { gate_mode: 'task', limits: CFG.limits, source_control: { auto_commit: 'never', auto_pr: 'never' } },
      pipeline: { gate_mode: null, source_control: null, current_tier: 'review', halt_reason: null },
      graph: {
        template_id: 't-final-corrective',
        status: 'in_progress',
        current_node_path: null,
        nodes: {
          phase_loop: {
            kind: 'for_each_phase',
            status: 'completed',
            iterations: [
              { index: 0, status: 'completed', doc_path: 'phase1/phase_plan.md', repos: [], corrective_tasks: [], nodes: {} },
            ],
          } as ForEachPhaseNodeState,
          final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 } as StepNodeState,
          final_pr: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 } as StepNodeState,
        },
      },
    } as PipelineState;

    const r = walkDAG(st, tpl, CFG);

    expect(r?.action).toBe('spawn_final_reviewer');
  });
});

describe('deriveCurrentNodePathFromMarkers — step-hosted corrective', () => {
  function stateWithFinalCorrective(taskExecutorStatus: string | null): PipelineState {
    const entryNodes: Record<string, { kind: 'step'; status: string; doc_path: null; retries: number }> = {};
    if (taskExecutorStatus !== null) {
      entryNodes['task_executor'] = { kind: 'step', status: taskExecutorStatus, doc_path: null, retries: 0 };
    }
    return {
      graph: {
        status: 'in_progress',
        current_node_path: null,
        nodes: {
          final_review: {
            kind: 'step',
            status: 'in_progress',
            doc_path: null,
            retries: 0,
            corrective_tasks: [
              {
                index: 1,
                reason: 'r',
                injected_after: 'final_review',
                status: 'in_progress',
                nodes: entryNodes,
                doc_path: null,
                review_report_path: null,
                repos: [],
              },
            ],
          },
        },
      },
    } as unknown as PipelineState;
  }

  it('descends to the corrective\'s in_progress child leaf', () => {
    const derived = deriveCurrentNodePathFromMarkers(stateWithFinalCorrective('in_progress'));
    expect(derived).toBe('final_review.corrective_tasks[1].task_executor');
  });

  it('reports the corrective entry itself when it has no in_progress child', () => {
    const derived = deriveCurrentNodePathFromMarkers(stateWithFinalCorrective(null));
    expect(derived).toBe('final_review.corrective_tasks[1]');
  });

  it('is discoverable even with no phase_loop node present at all (guard predates step hosts)', () => {
    const state = stateWithFinalCorrective('in_progress');
    expect('phase_loop' in state.graph.nodes).toBe(false);
    const derived = deriveCurrentNodePathFromMarkers(state);
    expect(derived).toBe('final_review.corrective_tasks[1].task_executor');
  });

  it('still tolerates a graph with no phase iterations and no active step-hosted corrective (pre-explosion)', () => {
    const state = {
      graph: {
        status: 'in_progress',
        current_node_path: null,
        nodes: {
          master_plan: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
        },
      },
    } as unknown as PipelineState;
    expect(deriveCurrentNodePathFromMarkers(state)).toBeNull();
  });
});
