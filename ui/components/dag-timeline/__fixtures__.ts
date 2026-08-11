/**
 * Shared test fixtures for dag-timeline component tests.
 */
import type {
  StepNodeState,
  GateNodeState,
  ConditionalNodeState,
  ParallelNodeState,
  ForEachPhaseNodeState,
  ForEachTaskNodeState,
  CorrectiveTaskEntry,
  IterationEntry,
  AnyProjectState,
} from '@/types/state';

/** Minimal project state fixture — enough for `deriveRetryBudget`'s `resolveMaxRetriesPerTask` read. */
export function makeProjectState(maxRetriesPerTask = 2): AnyProjectState {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: maxRetriesPerTask },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'std', status: 'in_progress', current_node_path: null, nodes: {} },
  };
}

export const baseProjectState: AnyProjectState = makeProjectState();

export const stepNode: StepNodeState = {
  kind: 'step',
  status: 'not_started',
  doc_path: null,
  retries: 0,
};

export const gateNode: GateNodeState = {
  kind: 'gate',
  status: 'not_started',
  gate_active: false,
};

export const conditionalNode: ConditionalNodeState = {
  kind: 'conditional',
  status: 'not_started',
  branch_taken: null,
};

export const conditionalNodeBranchTrue: ConditionalNodeState = {
  kind: 'conditional',
  status: 'completed',
  branch_taken: 'true',
};

export const conditionalNodeBranchFalse: ConditionalNodeState = {
  kind: 'conditional',
  status: 'completed',
  branch_taken: 'false',
};

export const parallelNode: ParallelNodeState = {
  kind: 'parallel',
  status: 'not_started',
  nodes: {},
};

export const forEachPhaseNode: ForEachPhaseNodeState = {
  kind: 'for_each_phase',
  status: 'not_started',
  iterations: [],
};

export const forEachTaskNode: ForEachTaskNodeState = {
  kind: 'for_each_task',
  status: 'not_started',
  iterations: [],
};

export const baseCorrectiveTask: CorrectiveTaskEntry = {
  index: 1,
  reason: 'Test reason',
  injected_after: 'task_executor',
  status: 'not_started',
  nodes: {},
  doc_path: 'tasks/t1-fix.md',
  repos: [],
};

export const taskLoopIteration: IterationEntry = {
  index: 0,
  status: 'completed',
  doc_path: 'phases/p1-plan.md',
  nodes: {
    for_each_task: {
      kind: 'for_each_task',
      status: 'completed',
      iterations: [
        {
          index: 0,
          status: 'completed',
          doc_path: 'tasks/t1.md',
          nodes: {
            task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
            code_review: { kind: 'step', status: 'completed', doc_path: 'reviews/r1.md', retries: 0 },
            task_gate: { kind: 'gate', status: 'completed', gate_active: false },
          },
          corrective_tasks: [],
          repos: [{ name: '', commit_hash: 'def5678abc1234' }],
        },
      ],
    } satisfies ForEachTaskNodeState,
    phase_report: stepNode,
    phase_review: stepNode,
    phase_gate: gateNode,
  },
  corrective_tasks: [],
  repos: [{ name: '', commit_hash: 'abc1234def5678' }],
};

/** Simplified task loop iteration with a corrective task — focuses on corrective-task structure */
export const taskLoopIterationWithCorrective: IterationEntry = {
  index: 0,
  status: 'completed',
  doc_path: 'phases/p1-plan.md',
  nodes: {
    for_each_task: {
      kind: 'for_each_task',
      status: 'completed',
      iterations: [
        {
          index: 0,
          status: 'completed',
          doc_path: 'tasks/t1.md',
          nodes: {
            task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
            code_review: { kind: 'step', status: 'completed', doc_path: 'reviews/r1.md', retries: 0 },
            task_gate: { kind: 'gate', status: 'completed', gate_active: false },
          },
          corrective_tasks: [
            {
              index: 1,
              reason: 'Code review found issues',
              injected_after: 'code_review',
              status: 'completed',
              nodes: {},
              doc_path: 'tasks/t1-fix.md',
              repos: [],
            },
          ],
          repos: [{ name: '', commit_hash: 'aaa1111bbb2222' }],
        },
      ],
    } satisfies ForEachTaskNodeState,
    phase_gate: gateNode,
  },
  corrective_tasks: [],
  repos: [{ name: '', commit_hash: 'ccc3333ddd4444' }],
};

/** Compound node IDs used in getDisplayName tests */
export const compoundNodeIds = {
  simple: 'phase_planning',
  twoSegment: 'phase_loop.phase_planning',
  threeSegment: 'phase_loop.iter0.phase_planning',
  deeplyNested: 'phase_loop.iter0.task_loop.iter0.code_review',
  loopNode: 'phase_loop.iter0.task_loop',
  singleWord: 'requirements',
} as const;
