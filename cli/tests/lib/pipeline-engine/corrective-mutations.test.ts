// cli/tests/lib/pipeline-engine/corrective-mutations.test.ts
//
// Unit coverage for the code_review_completed mutation's corrective-of-a-
// corrective parent finalization (the HICCUP-TEST bug). When a corrective's
// own code_review returns changes_requested and births a successor corrective,
// the superseded parent corrective must be finalized to `completed` at birth —
// the walker only ever finalizes the LATEST corrective, so without this the
// parent is stranded at in_progress inside a later-completed iteration.
//
// These drive the mutation in isolation via getMutation(event)(state, ctx, cfg,
// tmpl); the mediation frontmatter that pre-read merges in production is passed
// directly on the context here.
import { describe, it, expect } from 'vitest';
import { getMutation } from '../../../src/lib/pipeline-engine/mutations.js';
import type {
  OrchestrationConfig,
  PipelineState,
  PipelineTemplate,
  EventContext,
} from '../../../src/lib/pipeline-engine/types.js';

const cfg = {
  limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
} as unknown as OrchestrationConfig;

// Minimal template carrying for_each_phase → for_each_task with a four-node body
// so findTaskLoopBodyDefs can scaffold a birthed corrective's body nodes.
const tmpl = {
  id: 't', version: '1', description: '',
  nodes: [
    {
      id: 'phase_loop', kind: 'for_each_phase', label: 'P', source_doc_ref: '', total_field: 'total_phases', depends_on: [],
      body: [
        {
          id: 'task_loop', kind: 'for_each_task', label: 'T', source_doc_ref: '', tasks_field: 'tasks', depends_on: [],
          body: [
            { id: 'task_gate', kind: 'gate' },
            { id: 'task_executor', kind: 'step' },
            { id: 'commit', kind: 'step' },
            { id: 'code_review', kind: 'step' },
          ],
        },
      ],
    },
  ],
} as unknown as PipelineTemplate;

const step = (status: string) => ({ kind: 'step', status, doc_path: null, retries: 0 });
const gate = (status: string, gate_active = false) => ({ kind: 'gate', status, gate_active });
const completedTaskLoop = () => ({
  kind: 'for_each_task', status: 'completed',
  iterations: [{ index: 0, status: 'completed', doc_path: null, repos: [], corrective_tasks: [], nodes: {} }],
});

/** An active (in_progress) corrective whose body is done except its code_review,
 *  which the incoming event will finalize. */
function activeCorrective(index: number, injectedAfter: string, codeReviewStatus: string) {
  return {
    index,
    reason: `${injectedAfter} requested changes`,
    injected_after: injectedAfter,
    status: 'in_progress',
    doc_path: `tasks/c${index}.md`,
    repos: [],
    nodes: {
      task_gate: gate('completed', true),
      task_executor: step('completed'),
      commit: step('completed'),
      code_review: { kind: 'step', status: codeReviewStatus, doc_path: null, retries: 0, verdict: 'changes_requested' },
    },
  };
}

// Mediation frontmatter (merged by pre-read in production) for a changes_requested
// review that births a successor corrective.
const CR_CHANGES_CTX = {
  phase: 1,
  task: 1,
  verdict: 'changes_requested',
  orchestrator_mediated: true,
  effective_outcome: 'changes_requested',
  corrective_handoff_path: 'tasks/cor-next.md',
  reason: 'Code review requested changes',
} as unknown as Partial<EventContext>;

type CT = { index: number; status: string; injected_after: string; doc_path: string | null; nodes: Record<string, { status: string }> };

function phaseCorrectives(state: PipelineState): CT[] {
  return (state.graph.nodes.phase_loop as unknown as { iterations: Array<{ corrective_tasks: CT[] }> })
    .iterations[0].corrective_tasks;
}
function taskCorrectives(state: PipelineState): CT[] {
  return (state.graph.nodes.phase_loop as unknown as {
    iterations: Array<{ nodes: { task_loop: { iterations: Array<{ corrective_tasks: CT[] }> } } }>;
  }).iterations[0].nodes.task_loop.iterations[0].corrective_tasks;
}

// ── Hand-built states ────────────────────────────────────────────────────────

// Phase-scope corrective-of-a-corrective: phaseIter holds an active phase
// corrective C1 whose code_review is about to complete.
function phaseScopeState(): PipelineState {
  return {
    graph: {
      status: 'in_progress',
      current_node_path: 'phase_loop[0].corrective_tasks[1].code_review',
      nodes: {
        phase_loop: {
          kind: 'for_each_phase',
          status: 'in_progress',
          iterations: [
            {
              index: 0, status: 'in_progress', doc_path: null, repos: [],
              corrective_tasks: [activeCorrective(1, 'phase_review', 'in_progress')],
              nodes: { task_loop: completedTaskLoop(), phase_gate: gate('completed'), phase_review: step('completed') },
            },
          ],
        },
      },
    },
  } as unknown as PipelineState;
}

// Task-scope corrective-of-a-corrective: taskIter holds an active task
// corrective C1 whose code_review is about to complete.
function taskScopeState(): PipelineState {
  const taskIter = {
    index: 0, status: 'in_progress', doc_path: null, repos: [{ name: 'backend', commit_hash: null }],
    corrective_tasks: [activeCorrective(1, 'code_review', 'in_progress')],
    nodes: { task_gate: gate('completed', true), task_executor: step('completed'), commit: step('completed'), code_review: step('completed') },
  };
  return {
    graph: {
      status: 'in_progress',
      current_node_path: 'phase_loop[0].task_loop[0].corrective_tasks[1].code_review',
      nodes: {
        phase_loop: {
          kind: 'for_each_phase',
          status: 'in_progress',
          iterations: [
            {
              index: 0, status: 'in_progress', doc_path: null, repos: [], corrective_tasks: [],
              nodes: {
                task_loop: { kind: 'for_each_task', status: 'in_progress', iterations: [taskIter] },
                phase_gate: gate('not_started'), phase_review: step('not_started'),
              },
            },
          ],
        },
      },
    },
  } as unknown as PipelineState;
}

// First corrective (no existing correctives) — the original task's code_review
// requests changes. The parent-finalization guard must be a no-op here.
function firstCorrectiveState(): PipelineState {
  const taskIter = {
    index: 0, status: 'in_progress', doc_path: null, repos: [{ name: 'backend', commit_hash: null }],
    corrective_tasks: [],
    nodes: { task_gate: gate('completed', true), task_executor: step('completed'), commit: step('completed'), code_review: step('in_progress') },
  };
  return {
    graph: {
      status: 'in_progress',
      current_node_path: 'phase_loop[0].task_loop[0].code_review',
      nodes: {
        phase_loop: {
          kind: 'for_each_phase',
          status: 'in_progress',
          iterations: [
            {
              index: 0, status: 'in_progress', doc_path: null, repos: [], corrective_tasks: [],
              nodes: {
                task_loop: { kind: 'for_each_task', status: 'in_progress', iterations: [taskIter] },
                phase_gate: gate('not_started'), phase_review: step('not_started'),
              },
            },
          ],
        },
      },
    },
  } as unknown as PipelineState;
}

const codeReviewCompleted = getMutation('code_review_completed')!;

describe('code_review_completed — corrective-of-a-corrective parent finalization', () => {
  it('phase scope: finalizes the superseded parent corrective and births the successor', () => {
    const result = codeReviewCompleted(phaseScopeState(), CR_CHANGES_CTX, cfg, tmpl);
    const cts = phaseCorrectives(result.state);
    expect(cts).toHaveLength(2);
    // The fix: parent C1 is finalized to completed (was in_progress).
    expect(cts[0].status).toBe('completed');
    // Successor C2 is born.
    expect(cts[1].index).toBe(2);
    expect(cts[1].injected_after).toBe('code_review');
    expect(cts[1].status).toBe('not_started');
    expect(cts[1].doc_path).toBe('tasks/cor-next.md');
    expect(result.mutations_applied.some(m => /finalized superseded corrective_task\[1\].*scope=phase/.test(m))).toBe(true);
  });

  it('task scope: finalizes the superseded parent corrective and births the successor', () => {
    const result = codeReviewCompleted(taskScopeState(), CR_CHANGES_CTX, cfg, tmpl);
    const cts = taskCorrectives(result.state);
    expect(cts).toHaveLength(2);
    expect(cts[0].status).toBe('completed');
    expect(cts[1].index).toBe(2);
    expect(cts[1].injected_after).toBe('code_review');
    expect(cts[1].status).toBe('not_started');
    expect(result.mutations_applied.some(m => /finalized superseded corrective_task\[1\].*scope=task/.test(m))).toBe(true);
  });

  it('first corrective (empty array): births exactly one corrective and finalizes no parent', () => {
    const result = codeReviewCompleted(firstCorrectiveState(), CR_CHANGES_CTX, cfg, tmpl);
    const cts = taskCorrectives(result.state);
    expect(cts).toHaveLength(1);
    expect(cts[0].index).toBe(1);
    expect(cts[0].injected_after).toBe('code_review');
    expect(cts[0].status).toBe('not_started');
    // The guard must be a no-op: no parent existed to finalize.
    expect(result.mutations_applied.some(m => /finalized superseded/.test(m))).toBe(false);
  });
});
