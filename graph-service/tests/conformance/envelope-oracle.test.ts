// graph-service/tests/conformance/envelope-oracle.test.ts
//
// The load-bearing conformance suite: boots a real graph-service daemon (`harness/boot.ts`) and
// drives it exclusively through `@rad-orchestration/graph-client`, then asserts that the emitted
// `NextActionEnvelope.context` carries what the *old* stack's enrichment layer
// (`cli/src/lib/pipeline-engine/context-enrichment.ts` — read as the spec, never imported or
// changed) promised every coder/reviewer sub-agent. Follows the precedent
// `cli/tests/lib/pipeline-engine/resolve-doc-paths.graph-parity.test.ts` set: every expected value
// below is a *literal*, never an import off `cli/` or `@rad-orchestration/graph-node-types` — this
// package must not take a code edge on either. Each literal's comment cites the oracle rule (or the
// new stack's own file/line) it was derived from, so a later reader can re-derive it without
// reopening the oracle.
//
// Six dimensions pinned (per the task handoff): (1) resolved absolute worktree paths, (2) resolved
// absolute doc paths, (3) level-specific SHA field names, (4) complexity -> agent outcome, (5)
// `should_commit`, (6) corrective handoff routing. Two deliberate divergences from the oracle are
// asserted rather than treated as bugs: doc-path confinement (the oracle only normalizes; the new
// resolver refuses an escape), and `review_report_path` omission (never a `null`) when a spawn
// carries none.
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { GraphClient, GraphClientError } from '@rad-orchestration/graph-client';
import type { NextActionEnvelope } from '@rad-orchestration/graph-client';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';

const REPO_NAME = 'rad-orc-source';
const REPO_BRANCH = 'radorch/STEERABLE-DAG-2.7';

/**
 * Registers `repo` against `project` via the plain `/work-graph/worktree` route — the same
 * out-of-band setup `graph-client.integration.test.ts`'s own `addWorktree` uses, never a
 * `GraphClient` method (the client carries no worktree surface). Leaving `path` unset means the
 * resulting `WorktreeRecord.path` stays `null`, exercising the *conventional* join
 * (`resolveWorktreeRepoSet`'s fallback) rather than a stored path — the standard-project case the
 * handoff calls out.
 */
async function addWorktree(baseUrl: string, projectId: string, repo: string): Promise<void> {
  const res = await fetch(`${baseUrl}/work-graph/worktree`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, repo }),
  });
  if (!res.ok) throw new Error(`addWorktree('${projectId}', '${repo}') failed: HTTP ${res.status}`);
}

/** Unwraps a non-null `context`, failing loud (rather than a confusing downstream property-access
 * crash) if a scenario ever engages a node that produced none. */
function contextOf(envelope: NextActionEnvelope): Record<string, unknown> {
  if (envelope.context === null) throw new Error('expected submitEvent to stop at a node with a non-null context');
  return envelope.context as Record<string, unknown>;
}

describe('conformance: envelope fields against the frozen oracle (cli/src/lib/pipeline-engine/context-enrichment.ts)', () => {
  let daemon: BootedDaemon;

  beforeEach(async () => {
    daemon = await bootDaemon();
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  /** `dbPath` is `<root>/graph.sqlite` (`harness/boot.ts`) — the one way this suite recovers the
   * daemon's own radorc `root` without the harness exposing it directly. */
  function radorcRoot(): string {
    return path.dirname(daemon.dbPath);
  }

  function client(): GraphClient {
    return new GraphClient({ baseUrl: daemon.baseUrl() });
  }

  // Oracle rule, cited verbatim in the handoff's "External surface": `lib/work-graph/src/derive/
  // worktrees.ts` — `path.join(worktreesDir, sc.worktree_name ?? projectName, repo.name)`. No
  // custom `worktree_name` is set anywhere in this suite (the standard-project case), so the
  // convention collapses to `<root>/worktrees/<projectId>/<repo>`.
  function expectedWorktreePath(projectId: string, repo: string): string {
    return path.join(radorcRoot(), 'worktrees', projectId, repo);
  }

  // Oracle rule: `context-enrichment.ts:142`'s `resolveDocPaths` joins a relative doc path against
  // `<root>/projects/<projectId>` — the same per-project root `explode-master-plan.ts`'s
  // `toRelativeDocPath` made the stored paths relative to.
  function expectedDocPath(projectId: string, ...segments: string[]): string {
    return path.join(radorcRoot(), 'projects', projectId, ...segments);
  }

  describe('dimension 1 — repos[].path resolves the same worktree convention buildReposArray produces', () => {
    it('joins <root>/worktrees/<projectId>/<repo> for a task coder spawn', async () => {
      const projectId = 'worktree-paths';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'task-a',
          type: 'rad-orc:task',
          parent: ROOT_NODE_ID,
          data: {
            handoffDocPath: 'tasks/task-a.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
            complexity: 'standard',
            shouldCommit: true,
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'task-a' });
      const repos = contextOf(engaged).repos as Array<Record<string, unknown>>;

      expect(repos).toEqual([{ name: REPO_NAME, path: expectedWorktreePath(projectId, REPO_NAME), branch: REPO_BRANCH }]);
    });

    it('fails loud rather than handing a coder an unresolved repo — the new stack\'s per-repo version of the oracle\'s execute_task guard', async () => {
      // Old-stack guard (context-enrichment.ts:349-358): an empty resolved `repos[]` throws naming
      // "pipeline.source_control is not initialized" rather than spawning a coder with no working
      // directory. The new stack's dataSchema already requires a non-empty `repos` array (so the
      // whole-array-empty framing can't occur here); its own fail-loud equivalent is per-repo
      // (`resolve-fields.ts`'s `resolveWorktreeRepoSet`: "A repo with no record at all is refused,
      // not conventionalized"). Deliberately not reproduced: the oracle's *whole-array* framing —
      // only the per-repo refusal below is asserted, since that is the shape this stack can hit.
      const projectId = 'worktree-unresolved';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'task-a',
          type: 'rad-orc:task',
          parent: ROOT_NODE_ID,
          data: {
            handoffDocPath: 'tasks/task-a.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
            complexity: 'standard',
            shouldCommit: true,
          },
        },
      ]);
      // Deliberately no addWorktree call — no WorktreeRecord exists for REPO_NAME.

      let caught: unknown;
      try {
        await project.submitEvent({ node: 'task-a' });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphClientError);
      expect((caught as GraphClientError).code).toBe('invalid_delta');
    });
  });

  describe('dimension 2 — doc paths resolve against <root>/projects/<projectId>, the same root resolveDocPaths joins against', () => {
    it('resolves handoff_doc at task level', async () => {
      const projectId = 'doc-paths-task';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'task-a',
          type: 'rad-orc:task',
          parent: ROOT_NODE_ID,
          data: {
            handoffDocPath: 'tasks/task-a.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
            complexity: 'standard',
            shouldCommit: true,
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'task-a' });
      expect(contextOf(engaged).handoff_doc).toBe(expectedDocPath(projectId, 'tasks/task-a.md'));
    });

    it('resolves phase_plan_doc at phase level', async () => {
      const projectId = 'doc-paths-phase';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'phase-review',
          type: 'rad-orc:code_review',
          parent: ROOT_NODE_ID,
          data: {
            level: 'phase',
            reviewReportPath: 'reviews/phase-01-review.md',
            phasePlanDocPath: 'phases/PHASE-01.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'phase-review' });
      expect(contextOf(engaged).phase_plan_doc).toBe(expectedDocPath(projectId, 'phases/PHASE-01.md'));
      expect(contextOf(engaged).review_report_path).toBe(expectedDocPath(projectId, 'reviews/phase-01-review.md'));
    });

    it('resolves requirements_doc and phase_plan_paths[] element-wise at final level', async () => {
      const projectId = 'doc-paths-final';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'final-review',
          type: 'rad-orc:code_review',
          parent: ROOT_NODE_ID,
          data: {
            level: 'final',
            reviewReportPath: 'reviews/final-review.md',
            requirementsDocPath: 'requirements/REQUIREMENTS.md',
            phasePlanPaths: ['phases/PHASE-01.md', 'phases/PHASE-02.md'],
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'final-review' });
      const ctx = contextOf(engaged);
      expect(ctx.requirements_doc).toBe(expectedDocPath(projectId, 'requirements/REQUIREMENTS.md'));
      expect(ctx.phase_plan_paths).toEqual([
        expectedDocPath(projectId, 'phases/PHASE-01.md'),
        expectedDocPath(projectId, 'phases/PHASE-02.md'),
      ]);
    });

    it('divergence: refuses a doc path that escapes the project root, where the oracle only normalizes it', async () => {
      // The oracle (`resolveDocPaths`, `cli/src/lib/pipeline-engine/resolve-doc-paths.ts`) is a
      // normalization helper only — a `../` traversal resolves to wherever it lands, silently. The
      // new resolver (`resolve-fields.ts`'s `resolveProjectDocPath`, via `capabilities/real.ts`'s
      // `resolveWithinRoot`) refuses instead: a real behavior change this iteration calls for, not
      // a regression to patch over.
      const projectId = 'doc-paths-escape';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'task-a',
          type: 'rad-orc:task',
          parent: ROOT_NODE_ID,
          data: {
            handoffDocPath: '../escape.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
            complexity: 'standard',
            shouldCommit: true,
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      let caught: unknown;
      try {
        await project.submitEvent({ node: 'task-a' });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphClientError);
      expect((caught as GraphClientError).code).toBe('invalid_delta');
    });
  });

  describe('dimension 3 — level-specific SHA field names are never collapsed onto one shared name', () => {
    // Every raw fixture below seeds *all five* SHA-shaped fields on the one repo entry — proving
    // the review node type's own per-level extraction (`code-review.ts`'s `taskRepos`/`phaseRepos`/
    // `finalRepos`) strips the fields that don't belong at its level, rather than leaking them
    // through. Field names cited from `context-enrichment.ts`'s `spawn_phase_reviewer`/
    // `spawn_final_reviewer` branches and the `rad-code-review` skill's scope table
    // (mirrored verbatim in `lib/graph-node-types/tests/fixtures/frozen-contracts.ts`'s
    // `TaskRepoShas`/`PhaseRepoShas`/`FinalRepoShas`).
    function allShaFields(): Record<string, unknown> {
      return {
        head_sha: 'aaa1111',
        phase_first_sha: 'bbb2222',
        phase_head_sha: 'ccc3333',
        project_base_sha: 'ddd4444',
        project_head_sha: 'eee5555',
      };
    }

    it('task level carries head_sha only', async () => {
      const projectId = 'sha-fields-task';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'task-review',
          type: 'rad-orc:code_review',
          parent: ROOT_NODE_ID,
          data: {
            level: 'task',
            reviewReportPath: 'reviews/task-review.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH, ...allShaFields() }],
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'task-review' });
      const repos = contextOf(engaged).repos as Array<Record<string, unknown>>;
      expect(repos).toEqual([{ name: REPO_NAME, path: expectedWorktreePath(projectId, REPO_NAME), branch: REPO_BRANCH, head_sha: 'aaa1111' }]);
    });

    it('phase level carries phase_first_sha + phase_head_sha only', async () => {
      const projectId = 'sha-fields-phase';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'phase-review',
          type: 'rad-orc:code_review',
          parent: ROOT_NODE_ID,
          data: {
            level: 'phase',
            reviewReportPath: 'reviews/phase-review.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH, ...allShaFields() }],
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'phase-review' });
      const repos = contextOf(engaged).repos as Array<Record<string, unknown>>;
      expect(repos).toEqual([
        {
          name: REPO_NAME,
          path: expectedWorktreePath(projectId, REPO_NAME),
          branch: REPO_BRANCH,
          phase_first_sha: 'bbb2222',
          phase_head_sha: 'ccc3333',
        },
      ]);
    });

    it('final level carries project_base_sha + project_head_sha only', async () => {
      const projectId = 'sha-fields-final';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'final-review',
          type: 'rad-orc:code_review',
          parent: ROOT_NODE_ID,
          data: {
            level: 'final',
            reviewReportPath: 'reviews/final-review.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH, ...allShaFields() }],
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'final-review' });
      const repos = contextOf(engaged).repos as Array<Record<string, unknown>>;
      expect(repos).toEqual([
        {
          name: REPO_NAME,
          path: expectedWorktreePath(projectId, REPO_NAME),
          branch: REPO_BRANCH,
          project_base_sha: 'ddd4444',
          project_head_sha: 'eee5555',
        },
      ]);
    });

    // Not asserted: the oracle's `phase_head_sha` reverse-scan-filtering-for-non-null-commit_hash
    // vs. `phase_first_sha`'s plain-first-match asymmetry (`context-enrichment.ts`'s
    // `spawn_phase_reviewer` branch). That asymmetry lives in the *historical-commit-scan*
    // derivation that mints a review node's `repos[].phase_first_sha`/`phase_head_sha` in the first
    // place — logic this iteration's node-type/service layer doesn't yet own (no
    // `slice().reverse()` exists anywhere in `lib/graph-node-types/src`); this suite pins field-name
    // parity for whatever a caller seeds, not that not-yet-built derivation.
  });

  describe('dimension 4 — complexity -> agent outcome (harness-files/skills/rad-orchestration/references/pipeline-guide.md, executed by lib/graph-node-types/src/rad-orc/agent-tier.ts)', () => {
    it('task coder: simple -> coder-junior', async () => {
      const projectId = 'agent-tier-coder-junior';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'task-a',
          type: 'rad-orc:task',
          parent: ROOT_NODE_ID,
          data: {
            handoffDocPath: 'tasks/task-a.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
            complexity: 'simple',
            shouldCommit: true,
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'task-a' });
      expect(contextOf(engaged).agent).toBe('coder-junior');
    });

    it('task coder: standard and complex both -> coder', async () => {
      for (const complexity of ['standard', 'complex']) {
        const projectId = `agent-tier-coder-${complexity}`;
        const project = client().project(projectId);
        await project.seed([
          {
            primitive: 'add_node',
            id: 'task-a',
            type: 'rad-orc:task',
            parent: ROOT_NODE_ID,
            data: {
              handoffDocPath: 'tasks/task-a.md',
              repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
              complexity,
              shouldCommit: true,
            },
          },
        ]);
        await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

        const engaged = await project.submitEvent({ node: 'task-a' });
        expect(contextOf(engaged).agent).toBe('coder');
      }
    });

    it('task reviewer: simple -> reviewer-junior', async () => {
      const projectId = 'agent-tier-reviewer-junior';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'task-review',
          type: 'rad-orc:code_review',
          parent: ROOT_NODE_ID,
          data: {
            level: 'task',
            reviewReportPath: 'reviews/task-review.md',
            complexity: 'simple',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'task-review' });
      expect(contextOf(engaged).agent).toBe('reviewer-junior');
    });

    it('task reviewer: standard and complex both -> reviewer', async () => {
      for (const complexity of ['standard', 'complex']) {
        const projectId = `agent-tier-reviewer-${complexity}`;
        const project = client().project(projectId);
        await project.seed([
          {
            primitive: 'add_node',
            id: 'task-review',
            type: 'rad-orc:code_review',
            parent: ROOT_NODE_ID,
            data: {
              level: 'task',
              reviewReportPath: 'reviews/task-review.md',
              complexity,
              repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
            },
          },
        ]);
        await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

        const engaged = await project.submitEvent({ node: 'task-review' });
        expect(contextOf(engaged).agent).toBe('reviewer');
      }
    });

    it('phase and final reviewers are always reviewer, regardless of complexity', async () => {
      for (const level of ['phase', 'final'] as const) {
        const projectId = `agent-tier-reviewer-${level}-always`;
        const project = client().project(projectId);
        await project.seed([
          {
            primitive: 'add_node',
            id: 'review',
            type: 'rad-orc:code_review',
            parent: ROOT_NODE_ID,
            data: {
              level,
              reviewReportPath: 'reviews/review.md',
              complexity: 'simple', // deliberately the tier that would demote a task-level review
              repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
            },
          },
        ]);
        await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

        const engaged = await project.submitEvent({ node: 'review' });
        expect(contextOf(engaged).agent).toBe('reviewer');
      }
    });
  });

  describe('dimension 5 — should_commit rides through unchanged', () => {
    it('true and false both ride through by field name', async () => {
      for (const shouldCommit of [true, false]) {
        const projectId = `should-commit-${shouldCommit}`;
        const project = client().project(projectId);
        await project.seed([
          {
            primitive: 'add_node',
            id: 'task-a',
            type: 'rad-orc:task',
            parent: ROOT_NODE_ID,
            data: {
              handoffDocPath: 'tasks/task-a.md',
              repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
              complexity: 'standard',
              shouldCommit,
            },
          },
        ]);
        await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

        const engaged = await project.submitEvent({ node: 'task-a' });
        expect(contextOf(engaged).should_commit).toBe(shouldCommit);
      }
    });
  });

  describe('dimension 6 — corrective handoff routing (context-enrichment.ts correctiveReportFields + execute_task/spawn_code_reviewer corrective branches)', () => {
    it('an original (non-corrective) task omits review_report_path entirely — never a null', async () => {
      // Oracle rule: `correctiveReportFields` (context-enrichment.ts:169-176) omits the key
      // (never emits `null`) when the entry carries no non-empty report path — reproduced by
      // `task.ts`'s optional spread (`...(typeof ctx.data.reviewReportPath === 'string' ? {...} : {})`).
      const projectId = 'corrective-omission';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'task-a',
          type: 'rad-orc:task',
          parent: ROOT_NODE_ID,
          data: {
            handoffDocPath: 'tasks/task-a.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
            complexity: 'standard',
            shouldCommit: true,
            // no reviewReportPath key at all
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'task-a' });
      const ctx = contextOf(engaged);
      expect('review_report_path' in ctx).toBe(false);
      expect(ctx.handoff_doc).toBe(expectedDocPath(projectId, 'tasks/task-a.md'));
    });

    it('an original task that already carries a running review_report_path surfaces it (resolved), same as a corrective', async () => {
      const projectId = 'corrective-task-with-report';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'task-a',
          type: 'rad-orc:task',
          parent: ROOT_NODE_ID,
          data: {
            handoffDocPath: 'tasks/task-a.md',
            reviewReportPath: 'reviews/task-a-review.md',
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
            complexity: 'standard',
            shouldCommit: true,
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'task-a' });
      expect(contextOf(engaged).review_report_path).toBe(expectedDocPath(projectId, 'reviews/task-a-review.md'));
    });

    it('a correcting attempt carries the original handoff_doc unchanged, alongside review_report_path and corrective_index', async () => {
      // `corrective_index` is always present on a corrective attempt (never omitted) — the new
      // stack's equivalent of the oracle's `correctiveReportFields`' always-present
      // `corrective_index` (context-enrichment.ts:170), reproduced by `corrective.ts`'s required
      // `correctiveIndex` data field (never optional, unlike a first task attempt's report path).
      const projectId = 'corrective-attempt';
      const project = client().project(projectId);
      await project.seed([
        {
          primitive: 'add_node',
          id: 'task-a-corrective-1',
          type: 'rad-orc:corrective',
          parent: ROOT_NODE_ID,
          data: {
            handoffDocPath: 'tasks/task-a.md', // the chain's original scope contract, unchanged
            reviewReportPath: 'reviews/task-a-review.md', // the running report this attempt self-mediates into
            repos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
            complexity: 'standard',
            shouldCommit: true,
            correctiveIndex: 1,
          },
        },
      ]);
      await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

      const engaged = await project.submitEvent({ node: 'task-a-corrective-1' });
      const ctx = contextOf(engaged);
      expect(ctx.handoff_doc).toBe(expectedDocPath(projectId, 'tasks/task-a.md'));
      expect(ctx.review_report_path).toBe(expectedDocPath(projectId, 'reviews/task-a-review.md'));
      expect(ctx.corrective_index).toBe(1);
      expect(ctx.agent).toBe('coder'); // remaining budget (default 5) - 1 = 4 > 2 -> base tier, unescalated
    });
  });
});
