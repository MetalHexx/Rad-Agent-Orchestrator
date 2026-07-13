// graph-service/tests/fixtures/phase-chain.ts
//
// A phase → task → code_review → pr chain — the linear shape `lib/graph-node-types`'s own
// integration proofs seed (`tests/integration/seed-and-run.test.ts`'s per-task decoration,
// `tests/integration/recovery-and-pr.test.ts`'s task/review pair), reused here as this suite's one
// linear fixture. `phaseChainThroughReviewSeedSteps` slices the same shape down to task+review for
// the corrective-loop/halt-resume scenarios, which never touch the `pr` node.
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import type { SeedStep } from '../harness/drive.js';
import { FIXTURE_PR_REPO, FIXTURE_REPO, taskData } from './repos.js';

export const PHASE_CHAIN_IDS = {
  phase: 'phase-1',
  task: 'task-1',
  review: 'review-1',
  pr: 'pr-1',
} as const;

/** Where the `review-1` node's resolver reads its verdict from — the default `reviews/{id}.md` it derives when its `data.reviewReportPath` is unset (the fixture leaves it unset). */
export const REVIEW_REPORT_PATH = `reviews/${PHASE_CHAIN_IDS.review}.md`;

/** A review report whose frontmatter carries the verdict the service reads — the `doc-read` real input that replaces the retired driver script's canned answer. */
export function reviewReportDoc(verdict: string, severity: string): string {
  return `---\nverdict: ${verdict}\nseverity: ${severity}\n---\n\n# Review Report\n\nOne running report, re-adjudicated in place.\n`;
}

export function phaseChainSeedSteps(): readonly SeedStep[] {
  return [
    {
      primitive: 'add_node',
      id: PHASE_CHAIN_IDS.phase,
      type: 'rad-orc:phase',
      parent: ROOT_NODE_ID,
      data: { docPath: 'docs/phases/phase-1.md', exitCriteria: ['Foundations laid'] },
    },
    {
      primitive: 'add_node',
      id: PHASE_CHAIN_IDS.task,
      type: 'rad-orc:task',
      parent: PHASE_CHAIN_IDS.phase,
      data: taskData('/tasks/task-1.md'),
    },
    {
      primitive: 'add_node',
      id: PHASE_CHAIN_IDS.review,
      type: 'rad-orc:code_review',
      parent: PHASE_CHAIN_IDS.phase,
      data: { level: 'task', repos: [FIXTURE_REPO] },
      dependsOn: [PHASE_CHAIN_IDS.task],
    },
    {
      primitive: 'add_node',
      id: PHASE_CHAIN_IDS.pr,
      type: 'rad-orc:pr',
      parent: ROOT_NODE_ID,
      data: { repos: [FIXTURE_PR_REPO] },
      dependsOn: [PHASE_CHAIN_IDS.review],
    },
  ];
}

/** The same chain, sliced down to `phase` → `task` → `code_review` — the corrective-loop/halt-resume scenarios' own fixture, which never opens a PR. */
export function phaseChainThroughReviewSeedSteps(): readonly SeedStep[] {
  return phaseChainSeedSteps().slice(0, 3);
}
