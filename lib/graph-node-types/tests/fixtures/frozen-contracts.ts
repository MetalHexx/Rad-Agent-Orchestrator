// Typed fixtures inventorying the frozen wire contracts the built-in node types are authored
// against: the review-report shape (`harness-files/skills/rad-code-review`), the task-handoff
// shape and the coder spawn/return contract (`harness-files/skills/rad-execute-coding-task`), and
// the commit/PR contracts (`harness-files/skills/rad-source-control/references`). Every fixture
// encodes field *names and shapes* pulled verbatim from those skill docs — never their prose — so
// a later built-in (or its tests) can assert against these shapes instead of re-reading the skills.
import type { ReviewVerdict, Severity } from '../../src/rad-orc/code-review.js';

// ── Review report frontmatter ───────────────────────────────────────────────────
// rad-code-review/SKILL.md (base fields + verdict/severity vocab), task-review.md (task-adds),
// phase-review.md (phase-adds), final-review.md (no scope-specific additions).

export interface ReviewReportFrontmatterBase {
  readonly project: string;
  readonly verdict: ReviewVerdict;
  readonly severity: Severity;
  readonly author: string;
  readonly created: string;
}

/** Present only on a report covering a corrective cycle — at either task or phase scope. */
export interface CorrectiveCycleFrontmatter {
  readonly corrective_index?: number;
  readonly corrective_scope?: 'task' | 'phase';
}

export interface TaskReviewFrontmatter extends ReviewReportFrontmatterBase, CorrectiveCycleFrontmatter {
  readonly phase: number;
  readonly task: number;
}

export interface PhaseReviewFrontmatter extends ReviewReportFrontmatterBase, CorrectiveCycleFrontmatter {
  readonly phase: number;
  readonly exit_criteria_met: boolean;
}

/** No `phase`/`task`/`exit_criteria_met` — final review is strict-and-final, never corrective. */
export type FinalReviewFrontmatter = ReviewReportFrontmatterBase;

export const TASK_REVIEW_FRONTMATTER_FIXTURE: TaskReviewFrontmatter = {
  project: 'STEERABLE-DAG-1',
  verdict: 'changes_requested',
  severity: 'medium',
  author: 'reviewer-agent',
  created: '2026-07-07T00:00:00.000Z',
  phase: 4,
  task: 2,
  corrective_index: 1,
  corrective_scope: 'task',
};

export const PHASE_REVIEW_FRONTMATTER_FIXTURE: PhaseReviewFrontmatter = {
  project: 'STEERABLE-DAG-1',
  verdict: 'approved',
  severity: 'none',
  author: 'reviewer-agent',
  created: '2026-07-07T00:00:00.000Z',
  phase: 4,
  exit_criteria_met: true,
};

export const FINAL_REVIEW_FRONTMATTER_FIXTURE: FinalReviewFrontmatter = {
  project: 'STEERABLE-DAG-1',
  verdict: 'approved',
  severity: 'none',
  author: 'reviewer-agent',
  created: '2026-07-07T00:00:00.000Z',
};

// ── Review report body markers ─────────────────────────────────────────────────

export const REVIEW_REPORT_MARKERS = {
  scope: '## Scope',
  findings: '## Findings',
  exitCriteria: '## Exit Criteria',
  coderDispositions: '## Coder Dispositions',
} as const;

export function findingHeading(index: number, title: string, severity: Severity): string {
  return `### Finding ${index} — ${title} · ${severity}`;
}

// ── Per-level SHA field names ───────────────────────────────────────────────────
// The seam to get right: these are level-specific and load-bearing — never collapsed onto one
// flat `head_sha` across levels (rad-code-review/SKILL.md's scope table).

export interface TaskRepoShas {
  readonly head_sha: string | null;
}

export interface PhaseRepoShas {
  readonly phase_first_sha: string | null;
  readonly phase_head_sha: string | null;
}

export interface FinalRepoShas {
  readonly project_base_sha: string | null;
  readonly project_head_sha: string | null;
}

export const TASK_REPO_SHA_FIXTURE: TaskRepoShas = { head_sha: 'a1b2c3d' };
export const PHASE_REPO_SHA_FIXTURE: PhaseRepoShas = { phase_first_sha: 'a1b2c3d', phase_head_sha: 'e4f5a6b' };
export const FINAL_REPO_SHA_FIXTURE: FinalRepoShas = { project_base_sha: '000abcd', project_head_sha: 'e4f5a6b' };

// ── Task-handoff frontmatter + body markers ─────────────────────────────────────
// rad-execute-coding-task/SKILL.md's "CWD hygiene" + "Execution Notes appendix" sections, and the
// task-handoff frontmatter shape this project's own task handoffs carry.

export interface HandoffRepo {
  readonly name: string;
  readonly path: string;
  readonly branch: string;
}

export interface TaskHandoffFrontmatter {
  readonly project: string;
  readonly phase: number;
  readonly task: number;
  readonly title: string;
  readonly status: string;
  readonly complexity: 'simple' | 'standard' | 'complex';
  readonly repos: readonly HandoffRepo[];
  readonly created: string;
  readonly type: 'task_handoff';
}

export const TASK_HANDOFF_FRONTMATTER_FIXTURE: TaskHandoffFrontmatter = {
  project: 'STEERABLE-DAG-1',
  phase: 4,
  task: 2,
  title: 'Registry, resolution & the frozen-contract normalization',
  status: 'pending',
  complexity: 'standard',
  repos: [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-1' }],
  created: '2026-07-07T23:41:52.698Z',
  type: 'task_handoff',
};

export function filesForRepoMarker(repoName: string): string {
  return `**Files for ${repoName}:**`;
}

export const TASK_HANDOFF_MARKERS = {
  executionNotes: '## Execution Notes',
  coderDispositions: '## Coder Dispositions',
} as const;

// ── Coder spawn contract ─────────────────────────────────────────────────────────
// rad-execute-coding-task/SKILL.md → "CWD hygiene" (spawn input) + "Output contract" (return).

export interface CoderSpawnRequest {
  readonly handoff_doc: string;
  readonly repos: readonly HandoffRepo[];
  readonly complexity: 'simple' | 'standard' | 'complex';
  readonly should_commit: boolean;
  readonly review_report_path?: string;
}

export interface CoderCommitResult {
  readonly name: string;
  readonly committed: boolean;
  readonly commitHash: string | null;
  readonly pushed: boolean;
}

export const CODER_SPAWN_REQUEST_FIXTURE: CoderSpawnRequest = {
  handoff_doc: '/project/tasks/EXAMPLE-TASK-P04-T02.md',
  repos: [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-1' }],
  complexity: 'standard',
  should_commit: true,
};

export const CODER_COMMIT_RESULT_FIXTURE: CoderCommitResult = {
  name: 'rad-orc-source',
  committed: true,
  commitHash: 'a1b2c3d',
  pushed: true,
};

// ── PR contract ───────────────────────────────────────────────────────────────────
// rad-source-control/references/working-with-prs.md → spawn input + "Report the result".

export interface PrRequestRepo {
  readonly name: string;
  readonly path: string;
  readonly branch: string;
  readonly base_branch: string;
}

export interface PrResult {
  readonly name: string;
  readonly pr_url: string | null;
}

export const PR_REQUEST_REPO_FIXTURE: PrRequestRepo = {
  name: 'rad-orc-source',
  path: '/repos/rad-orc-source',
  branch: 'radorch/STEERABLE-DAG-1',
  base_branch: 'main',
};

export const PR_RESULT_FIXTURE: PrResult = { name: 'rad-orc-source', pr_url: 'https://github.com/example/repo/pull/1' };
