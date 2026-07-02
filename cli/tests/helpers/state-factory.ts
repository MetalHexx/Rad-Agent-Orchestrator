/**
 * state-factory.ts
 *
 * Shared test helper that constructs complete PipelineState fixtures.
 * Includes v6 (current) and v5 (legacy) state builders for migration tests.
 * Reused by P02 schema tests, P03 tests, and P04 migration tests.
 */

export interface RepoEntry {
  name: string;
  commit_hash: string | null;
}

export interface MakeV6StateOptions {
  taskRepos: RepoEntry[];
}

export interface MakeV5StateOptions {
  /** commit_hash to place on the task iteration entry */
  taskCommitHash: string | null;
}

/**
 * Returns a complete v6 PipelineState with one phase iteration (whose own
 * repos is the union of taskRepos with hashes null) containing a task_loop
 * with one task iteration whose repos is the passed taskRepos.
 */
export function makeV6State(opts: MakeV6StateOptions): Record<string, unknown> {
  const { taskRepos } = opts;

  // Phase-level repos: same names as task repos but hashes null (union placeholder)
  const phaseRepos: RepoEntry[] = taskRepos.map((r) => ({
    name: r.name,
    commit_hash: null,
  }));

  const taskIteration = {
    index: 0,
    status: 'not_started',
    nodes: {},
    corrective_tasks: [],
    doc_path: null,
    repos: taskRepos,
  };

  const taskLoopNode = {
    kind: 'for_each_task',
    status: 'not_started',
    iterations: [taskIteration],
  };

  const phaseIteration = {
    index: 0,
    status: 'not_started',
    nodes: {
      task_loop: taskLoopNode,
    },
    corrective_tasks: [],
    doc_path: null,
    repos: phaseRepos,
  };

  const phaseLoopNode = {
    kind: 'for_each_phase',
    status: 'not_started',
    iterations: [phaseIteration],
  };

  return {
    $schema: 'orchestration-state-v6',
    project: {
      name: 'test-project',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
    },
    config: {
      gate_mode: 'ask',
      limits: {
        max_retries_per_task: 3,
      },
      source_control: {
        auto_commit: 'ask',
        auto_pr: 'ask',
      },
    },
    pipeline: {
      gate_mode: null,
      source_control: null,
      current_tier: 'planning',
      halt_reason: null,
    },
    graph: {
      template_id: 'standard',
      status: 'not_started',
      current_node_path: null,
      nodes: {
        phase_loop: phaseLoopNode,
      },
    },
  };
}

/**
 * Returns a complete v5 PipelineState with one phase iteration (whose own
 * commit_hash is null) containing a task_loop with one task iteration whose
 * commit_hash is the passed taskCommitHash.  Used as migration test input.
 * The v5 limits shape (max_phases / max_tasks_per_phase /
 * max_consecutive_review_rejections) is intentional — the archived v5 schema
 * requires those fields, and the v5→v6 migration drops them.
 */
export function makeValidV5State(opts: MakeV5StateOptions): Record<string, unknown> {
  const { taskCommitHash } = opts;

  const taskIteration = {
    index: 0,
    status: 'not_started',
    nodes: {},
    corrective_tasks: [],
    doc_path: null,
    commit_hash: taskCommitHash,
  };

  const taskLoopNode = {
    kind: 'for_each_task',
    status: 'not_started',
    iterations: [taskIteration],
  };

  const phaseIteration = {
    index: 0,
    status: 'not_started',
    nodes: {
      task_loop: taskLoopNode,
    },
    corrective_tasks: [],
    doc_path: null,
    commit_hash: null,
  };

  const phaseLoopNode = {
    kind: 'for_each_phase',
    status: 'not_started',
    iterations: [phaseIteration],
  };

  return {
    $schema: 'orchestration-state-v5',
    project: {
      name: 'test-project',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
    },
    config: {
      gate_mode: 'ask',
      limits: {
        max_phases: 10,
        max_tasks_per_phase: 20,
        max_retries_per_task: 3,
        max_consecutive_review_rejections: 3,
      },
      source_control: {
        auto_commit: 'ask',
        auto_pr: 'ask',
      },
    },
    pipeline: {
      gate_mode: null,
      source_control: null,
      current_tier: 'planning',
      halt_reason: null,
    },
    graph: {
      template_id: 'standard',
      status: 'not_started',
      current_node_path: null,
      nodes: {
        phase_loop: phaseLoopNode,
      },
    },
  };
}
