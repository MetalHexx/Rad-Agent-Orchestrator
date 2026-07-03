import type { NodesRecord, ProjectStateV5 } from "@/types/state";

// TEMPORARY — brainstorm inspection aid only, not part of the shipped feature.
// Delete this whole app/dag-widget-preview/ route once the review is done.

const NODES: NodesRecord = {
  master_plan: { kind: "step", status: "completed", doc_path: "DEMO-MASTER-PLAN.md", retries: 0 },
  plan_approval_gate: { kind: "gate", status: "not_started", gate_active: true },
  phase_loop: {
    kind: "for_each_phase",
    status: "in_progress",
    iterations: [
      {
        index: 0,
        status: "in_progress",
        doc_path: "phases/PHASE-01.md",
        corrective_tasks: [],
        repos: [],
        nodes: {
          task_loop: {
            kind: "for_each_task",
            status: "in_progress",
            iterations: [
              {
                index: 0,
                status: "in_progress",
                doc_path: "tasks/TASK-P01-T01.md",
                repos: [{ name: "ui", commit_hash: "a1b2c3d" }],
                corrective_tasks: [
                  {
                    index: 1,
                    reason: "Final review found a card-alignment regression",
                    injected_after: "code_review",
                    status: "in_progress",
                    doc_path: "tasks/CORRECTIVE-1.md",
                    repos: [{ name: "ui", commit_hash: "ct45678" }],
                    nodes: {
                      task_executor: { kind: "step", status: "in_progress", doc_path: null, retries: 0 },
                      code_review: { kind: "step", status: "not_started", doc_path: null, retries: 0 },
                    },
                  },
                ],
                nodes: {
                  task_executor: { kind: "step", status: "in_progress", doc_path: null, retries: 0 },
                  code_review: { kind: "step", status: "in_progress", doc_path: "reviews/REVIEW-1.md", retries: 0 },
                  task_gate: { kind: "gate", status: "not_started", gate_active: false },
                },
              },
            ],
          },
          phase_review: { kind: "step", status: "not_started", doc_path: "reviews/PHASE-01-REVIEW.md", retries: 0 },
          phase_gate: { kind: "gate", status: "not_started", gate_active: false },
        },
      },
    ],
  },
  final_review: { kind: "step", status: "in_progress", doc_path: "FINAL-REVIEW.md", retries: 0, verdict: null },
};

const SOURCE_CONTROL = {
  worktree_path: "/demo/worktree",
  auto_commit: "always" as const,
  auto_pr: "always" as const,
  repos: [
    {
      name: "ui",
      branch: "radorch/demo",
      base_branch: "main",
      remote_url: "https://github.com/example/rad-orc",
      compare_url: "https://github.com/example/rad-orc/compare/main...radorch/demo",
      pr_url: "https://github.com/example/rad-orc/pull/164",
    },
  ],
};

export const baseState: ProjectStateV5 = {
  $schema: "orchestration-state-v5",
  project: { name: "demo", created: "2026-01-01", updated: "2026-01-01" },
  config: {
    gate_mode: "task",
    limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
    source_control: { auto_commit: "always", auto_pr: "always" },
  },
  pipeline: { gate_mode: "task", source_control: SOURCE_CONTROL, current_tier: "execution", halt_reason: null },
  graph: { template_id: "std", status: "in_progress", current_node_path: "final_review", nodes: NODES },
};

export const completeState: ProjectStateV5 = {
  ...baseState,
  graph: {
    ...baseState.graph,
    status: "completed",
    current_node_path: null,
    nodes: {
      ...NODES,
      final_review: { kind: "step", status: "completed", doc_path: "FINAL-REVIEW.md", retries: 0, verdict: "approved" },
    },
  },
};

export interface PreviewEntry {
  key: string;
  label: string;
  state: ProjectStateV5;
  focus?: string;
}

export const PREVIEW_STATES: PreviewEntry[] = [
  { key: "planning", label: "Planning", state: baseState, focus: "master_plan" },
  { key: "plan-approval", label: "Plan Approval", state: baseState, focus: "plan_approval_gate" },
  { key: "coding", label: "Coding", state: baseState, focus: "phase_loop.iter0.task_loop.iter0.task_executor" },
  { key: "reviewing", label: "Reviewing", state: baseState, focus: "phase_loop.iter0.task_loop.iter0.code_review" },
  { key: "corrective", label: "Corrective", state: baseState, focus: "phase_loop.iter0.task_loop.iter0.ct1.task_executor" },
  { key: "phase-review", label: "Phase Review", state: baseState, focus: "phase_loop.iter0.phase_review" },
  { key: "final-review", label: "Final Review", state: baseState, focus: "final_review" },
  { key: "fallback", label: "Fallback (real \"final_pr\" node — issue #2)", state: baseState, focus: "final_pr" },
  { key: "complete", label: "Complete", state: completeState, focus: undefined },
];
