'use client';

/**
 * TEMPORARY DEV GALLERY — not linked from anywhere in the app.
 * Renders every DagStateCard state against hardcoded fixtures so all states can
 * be reviewed and tuned together at /dag-gallery. Delete this route (the whole
 * app/dag-gallery folder) before shipping.
 */

import { DagStateCard } from '@/components/dag-widget/dag-state-card';
import type { ProjectStateV5, NodesRecord, GraphStatus, RepoCommitEntry } from '@/types/state';

const REPOS: RepoCommitEntry[] = [
  { name: 'fake-api', commit_hash: 'abc1234def0' },
  { name: 'fake-ui', commit_hash: '9f8e7d6c5b4' },
];
const COMPARE: Record<string, string | null> = {
  'fake-api': 'https://github.com/o/fake-api/compare/main...x',
  'fake-ui': 'https://github.com/o/fake-ui/compare/main...x',
};
const PR_URL = 'https://github.com/o/fake-api/pull/164';

function base(nodes: NodesRecord, current: string | null, status: GraphStatus = 'in_progress', withPr = false): ProjectStateV5 {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'GALLERY', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: {
      gate_mode: 'task',
      source_control: withPr
        ? { worktree_path: '/tmp/g', auto_commit: 'never', auto_pr: 'never', repos: [{ name: 'fake-api', branch: 'b', base_branch: 'main', remote_url: null, compare_url: null, pr_url: PR_URL }] }
        : null,
      current_tier: 'execution',
      halt_reason: null,
    },
    graph: { template_id: 'std', status, current_node_path: current, nodes },
  };
}

// A phase_loop → task_loop tree deep enough for the work-state paths to resolve.
function workTree(withCorrective: boolean): NodesRecord {
  const taskNodes: NodesRecord = {
    task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
    code_review: { kind: 'step', status: 'in_progress', doc_path: 'reviews/DEMO-P01-T01-CODE-REVIEW.md', retries: 0, verdict: null },
  };
  const taskIter = {
    index: 0,
    status: 'in_progress' as const,
    doc_path: 'tasks/DEMO-TASK-P01-T01-AUTH-GUARD.md',
    repos: REPOS,
    corrective_tasks: withCorrective
      ? [{
          index: 1,
          status: 'in_progress' as const,
          doc_path: 'tasks/DEMO-CT-P01-T01.md',
          reason: 'Fix the null dereference in the auth guard that review flagged, and add a regression test',
          injected_after: 'code_review',
          repos: REPOS,
          nodes: {
            task_executor: { kind: 'step' as const, status: 'in_progress' as const, doc_path: null, retries: 0 },
            code_review: { kind: 'step' as const, status: 'in_progress' as const, doc_path: 'reviews/CR.md', retries: 0, verdict: null },
          },
        }]
      : [],
    nodes: taskNodes,
  };
  return {
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [{
        index: 0,
        status: 'in_progress',
        doc_path: 'phases/DEMO-PHASE-01-FOUNDATIONS.md',
        corrective_tasks: [],
        repos: [],
        nodes: {
          task_loop: { kind: 'for_each_task', status: 'in_progress', iterations: [taskIter] },
          phase_review: { kind: 'step', status: 'in_progress', doc_path: 'reviews/DEMO-PHASE-01-REVIEW.md', retries: 0, verdict: 'approved' },
        },
      }],
    },
  };
}

function finalTree(verdict: string | null): NodesRecord {
  return {
    // A finished phase loop so the ring's arc is full (phase progress complete)
    // and the verdict tint is actually visible on the arc, as on a live run.
    phase_loop: {
      kind: 'for_each_phase',
      status: 'completed',
      iterations: [0, 1, 2].map((i) => ({
        index: i, status: 'completed' as const, doc_path: `phases/DEMO-PHASE-0${i + 1}.md`, corrective_tasks: [], repos: [], nodes: {},
      })),
    },
    final_review: { kind: 'step', status: 'completed', doc_path: 'reviews/DEMO-FINAL-REVIEW.md', retries: 0, verdict },
    final_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
    pr_gate: { kind: 'conditional', status: 'in_progress', branch_taken: null },
    final_pr: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
  };
}

interface Entry { label: string; state: ProjectStateV5; compare: Record<string, string | null>; }

const ENTRIES: Entry[] = [
  { label: 'planning', state: base({ master_plan: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } }, 'master_plan'), compare: {} },
  {
    label: 'plan-approval',
    state: base({
      master_plan: { kind: 'step', status: 'completed', doc_path: 'plans/DEMO-MASTER-PLAN.md', retries: 0 },
      plan_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
    }, 'plan_approval_gate'),
    compare: {},
  },
  { label: 'coding', state: base(workTree(false), 'phase_loop.iter0.task_loop.iter0.task_executor'), compare: COMPARE },
  { label: 'reviewing', state: base(workTree(false), 'phase_loop.iter0.task_loop.iter0.code_review'), compare: COMPARE },
  { label: 'corrective', state: base(workTree(true), 'phase_loop.iter0.task_loop.iter0.ct1.task_executor'), compare: COMPARE },
  { label: 'phase-review', state: base(workTree(false), 'phase_loop.iter0.phase_review'), compare: {} },
  { label: 'final-review · needs work', state: base(finalTree('changes_requested'), 'pr_gate.branches.true.final_pr', 'in_progress', true), compare: {} },
  { label: 'final-review · passed', state: base(finalTree('approved'), 'pr_gate.branches.true.final_pr', 'in_progress', true), compare: {} },
  { label: 'final-review · rejected', state: base(finalTree('rejected'), 'pr_gate.branches.true.final_pr', 'in_progress', true), compare: {} },
  { label: 'complete', state: base(finalTree('approved'), null, 'completed', true), compare: {} },
  { label: 'fallback', state: base({ some_unmapped_node: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } }, 'some_unmapped_node'), compare: {} },
];

export default function DagGalleryPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
        <strong>Temporary dev gallery.</strong> Every DagStateCard state on hardcoded fixtures. Not linked from the app — delete <code>app/dag-gallery/</code> before shipping.
      </div>
      <div className="flex flex-col gap-8">
        {ENTRIES.map((e) => (
          <section key={e.label}>
            <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">{e.label}</h2>
            <DagStateCard
              state={e.state}
              onDocClick={() => {}}
              compareUrlByRepo={e.compare}
              projectName="GALLERY"
            />
          </section>
        ))}
      </div>
    </div>
  );
}
