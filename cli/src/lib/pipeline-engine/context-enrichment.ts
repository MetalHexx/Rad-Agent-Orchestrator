import { execFileSync } from 'node:child_process';
import { userDataPaths } from '../paths.js';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import type {
  PipelineState,
  OrchestrationConfig,
  EventContext,
  CorrectiveTaskEntry,
  ForEachPhaseNodeState,
  ForEachTaskNodeState,
  StepNodeState,
} from './types.js';

type CommitResolution =
  | { status: 'resolved'; position: number }
  | { status: 'ambiguous' }
  | { status: 'not_found' };

/**
 * Resolve a stored commit hash (any width the repo's `commit_hash` field may
 * carry, 7 to 40 characters) against an ordinal map keyed on full 40-character
 * SHAs, by prefix relation rather than a fixed-width slice — a shorter stored
 * hash and a longer one for the same commit must resolve identically. A
 * prefix that matches more than one full SHA is `ambiguous` rather than
 * silently resolved to whichever entry the map happened to iterate first —
 * mirroring git's own refusal to resolve an ambiguous abbreviated object name.
 */
function resolveOrdinalPosition(ordinal: Map<string, number>, commit: string): CommitResolution {
  const exact = ordinal.get(commit);
  if (exact !== undefined) return { status: 'resolved', position: exact };

  let match: number | undefined;
  for (const [fullSha, position] of ordinal) {
    if (fullSha.startsWith(commit)) {
      if (match !== undefined) return { status: 'ambiguous' };
      match = position;
    }
  }
  return match !== undefined ? { status: 'resolved', position: match } : { status: 'not_found' };
}

/**
 * Validate that every commit in a repo's accumulated commit range is
 * reachable from that repo's `HEAD`, according to the git-history ordinal
 * map. Returns an operator-facing rejection message naming the offending
 * repo and commit when one cannot be located or is an ambiguous abbreviation,
 * or null when every commit resolves to exactly one commit.
 *
 * @param commits - The repo's accumulated commit hashes, in any order and of
 *                  any width; each is resolved against `ordinal` by prefix.
 * @param ordinal - Full 40-character SHA to 1-based chronological position
 *                  (lower = older), derived from
 *                  `git rev-list --topo-order --reverse HEAD`.
 * @param repoName - Optional repo name to include in the rejection message.
 * @param repoPath - Optional worktree path to include in the rejection
 *                  message, so an operator can tell a stale binding from
 *                  rewritten history.
 */
export function validateCommitsReachableFromHead(
  commits: string[],
  ordinal: Map<string, number>,
  repoName?: string,
  repoPath?: string,
): string | null {
  const repoPrefix = repoName ? `Repo '${repoName}': ` : '';
  const pathSuffix = repoPath ? ` Path checked: '${repoPath}'.` : '';
  for (const commit of commits) {
    const resolution = resolveOrdinalPosition(ordinal, commit);
    if (resolution.status === 'ambiguous') {
      return (
        `${repoPrefix}the recorded commit '${commit}' is an ambiguous abbreviation — it matches more than ` +
        `one commit in this repository's history, so it cannot be resolved to a single commit.${pathSuffix} ` +
        `Record the full 40-character SHA for this commit (or a longer, unambiguous prefix), then re-run.`
      );
    }
    if (resolution.status === 'not_found') {
      return (
        `${repoPrefix}a recorded commit is not reachable from this repository's HEAD, so it cannot be ` +
        `placed in the commit history. Commit: '${commit}'.${pathSuffix} Confirm the commit exists in this ` +
        `repository's history (it may have been rewritten by a rebase or reset, or recorded against the wrong ` +
        `repository), then re-run.`
      );
    }
  }
  return null;
}

export interface EnrichmentInput {
  action: string;
  walkerContext: Record<string, unknown>;
  state: PipelineState;
  config: OrchestrationConfig;
  cliContext: Partial<EventContext>;
}

export function formatPhaseId(phaseNumber: number): string {
  return `P${String(phaseNumber).padStart(2, '0')}`;
}

export function formatTaskId(phaseNumber: number, taskNumber: number): string {
  return `${formatPhaseId(phaseNumber)}-T${String(taskNumber).padStart(2, '0')}`;
}

export function resolveActivePhaseIndex(state: PipelineState): number {
  const phaseLoop = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
  if (!phaseLoop?.iterations?.length) return 1;

  const matches = phaseLoop.iterations.filter(it => it.status === 'in_progress');
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous phase resolution: ${matches.length} phases are in_progress simultaneously. Pass --phase <N> to specify explicitly.`
    );
  }
  if (matches.length === 1) return matches[0].index + 1;

  // Corrective-aware: a phase whose last corrective entry is active is the
  // active phase even when its regular iteration already flipped completed.
  const correctivePhase = phaseLoop.iterations.find(it => {
    const cts = it.corrective_tasks ?? [];
    if (cts.length === 0) return false;
    const last = cts[cts.length - 1];
    return last.status === 'in_progress' || last.status === 'not_started';
  });
  if (correctivePhase) return correctivePhase.index + 1;

  const notStarted = phaseLoop.iterations.find(it => it.status === 'not_started');
  if (notStarted) return notStarted.index + 1;

  throw new Error(
    `Cannot resolve active phase: no phase is in_progress, no phase carries an active corrective, ` +
    `and no phase is not_started. State is unresolved — refusing to default to phase 1. ` +
    `Pass --phase <N> to specify explicitly.`
  );
}

export function resolveActiveTaskIndex(state: PipelineState, phaseIndex: number): number {
  const phaseLoop = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
  if (!phaseLoop?.iterations?.length) return 1;

  const phaseIteration = phaseLoop.iterations[phaseIndex - 1];
  if (!phaseIteration?.nodes) return 1;

  // Corrective-aware: when a phase-scope corrective is active on this phase,
  // task identity is the phase-scope sentinel — represented to callers as
  // task index 1 (the sentinel task_id/task_number override is applied by the
  // enrichment sentinel block, not here). Do NOT fall through to the task
  // loop, whose iterations are all completed during a phase corrective.
  const phaseCts = phaseIteration.corrective_tasks ?? [];
  if (phaseCts.length > 0) {
    const last = phaseCts[phaseCts.length - 1];
    if (last.status === 'in_progress' || last.status === 'not_started') return 1;
  }

  const taskLoop = phaseIteration.nodes['task_loop'] as ForEachTaskNodeState | undefined;
  if (!taskLoop?.iterations?.length) return 1;

  const matches = taskLoop.iterations.filter(it => it.status === 'in_progress');
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous task resolution: ${matches.length} tasks are in_progress simultaneously in phase ${phaseIndex}. Pass --task <N> to specify explicitly.`
    );
  }
  if (matches.length === 1) return matches[0].index + 1;

  const correctiveTask = taskLoop.iterations.find(it => {
    const cts = it.corrective_tasks ?? [];
    if (cts.length === 0) return false;
    const last = cts[cts.length - 1];
    return last.status === 'in_progress' || last.status === 'not_started';
  });
  if (correctiveTask) return correctiveTask.index + 1;

  const notStarted = taskLoop.iterations.find(it => it.status === 'not_started');
  if (notStarted) return notStarted.index + 1;

  throw new Error(
    `Cannot resolve active task in phase ${phaseIndex}: no task is in_progress, no task carries an ` +
    `active corrective, and no task is not_started. State is unresolved — refusing to default to task 1. ` +
    `Pass --task <N> to specify explicitly.`
  );
}

export interface ActiveFinalCorrective {
  hostId: string;
  host: StepNodeState;
  entry: CorrectiveTaskEntry;
  budgetOrigin: number;
}

/**
 * Scans top-level graph nodes for a step host whose windowed corrective list
 * ends in a `not_started` | `in_progress` entry. Null when none is active.
 *
 * The window is the engine's view of the list: entries before
 * `corrective_budget_origin` are audit history a fresh round must not see as
 * still active (see `final_corrective_requested`, which advances the origin).
 */
export function resolveActiveFinalCorrective(state: PipelineState): ActiveFinalCorrective | null {
  for (const [hostId, node] of Object.entries(state.graph.nodes)) {
    if (node.kind !== 'step') continue;
    const host = node as StepNodeState;
    const correctiveTasks = host.corrective_tasks;
    if (!correctiveTasks || correctiveTasks.length === 0) continue;

    const budgetOrigin = host.corrective_budget_origin ?? 0;
    const windowed = correctiveTasks.slice(budgetOrigin);
    if (windowed.length === 0) continue;

    const last = windowed[windowed.length - 1];
    if (last.status === 'not_started' || last.status === 'in_progress') {
      return { hostId, host, entry: last, budgetOrigin };
    }
  }
  return null;
}

const PLANNING_SPAWN_STEPS: Record<string, string> = {
  spawn_master_plan: 'master_plan',
};

const PHASE_LEVEL_ACTIONS = new Set([
  'spawn_phase_reviewer',
  'gate_phase',
]);

const TASK_LEVEL_ACTIONS = new Set([
  'execute_task',
  'spawn_code_reviewer',
  'gate_task',
]);

const EMPTY_CONTEXT_ACTIONS = new Set([
  'request_plan_approval',
  'ask_gate_mode',
  'display_complete',
]);

/**
 * Report-fields subset for a corrective-active spawn: the corrective's
 * window-relative `corrective_index` (1-based within the current budget
 * window — `entry.index - budgetOrigin`, so an operator change request doesn't
 * leak the raw ever-growing index into the fresh window it opens), plus
 * `review_report_path` when the entry carries a non-empty one (omitted
 * otherwise). Spread into the coder/reviewer spawn context so a correction
 * sees the review report that requested it. `budgetOrigin` defaults to 0 —
 * task/phase hosts never carry a budget origin, so their callers omit it.
 */
function correctiveReportFields(entry: CorrectiveTaskEntry, budgetOrigin = 0): Record<string, unknown> {
  const fields: Record<string, unknown> = { corrective_index: entry.index - budgetOrigin };
  const reportPath = entry.review_report_path;
  if (typeof reportPath === 'string' && reportPath.trim().length > 0) {
    fields.review_report_path = reportPath;
  }
  return fields;
}

/**
 * Resolve the pre-pipeline requirements doc (a `/rad-plan` artifact) via the
 * work-graph, keyed on project name. Returns the project-relative
 * `*-REQUIREMENTS.md` basename (mirroring the sibling `phase_plan_paths`
 * shape), or null when the project is unknown or carries no requirements doc
 * (there is no state field for this doc, so an unresolved lookup is a lost
 * convenience, not a blocker).
 */
function resolveRequirementsDoc(projectName: string): string | null {
  try {
    const paths = userDataPaths();
    const project = new WorkGraphService({
      root: paths.root,
      worktreesDir: paths.worktrees,
      sideProjectsDir: paths.sideProjects,
    }).listProjects().find(p => p.id === projectName);
    return project?.docs.requirements ?? null;
  } catch {
    return null; // discovery is a convenience, never a hard failure
  }
}

/**
 * Derive per-repo enrichment entries for any action that emits a `repos[]` array.
 *
 * For each entry in `state.pipeline.source_control.repos[]`, resolves the
 * absolute `path` fresh via `resolveWorktrees(projectId)` matched by repo name
 * (never a stored path — AD-2). Falls back to `path: ''` when the worktree
 * resolution fails or the repo is not found. Attaches `branch` from the sc
 * entry. When `perRepoSha` is supplied, attaches the return value as `head_sha`
 * on each entry (null → omitted). Single-repo state yields a length-1 array
 * with the same shape — no special-casing.
 *
 * @param state - Current pipeline state.
 * @param perRepoSha - Optional callback: receives each sc repo entry; returns
 *   the SHA to attach as `head_sha`, or null/undefined to omit it for that repo.
 */
function buildReposArray(
  state: PipelineState,
  perRepoSha?: (entry: { name: string }) => string | null | undefined,
): Array<Record<string, unknown>> {
  const scRepos = state.pipeline.source_control?.repos ?? [];
  const resolvedPaths: Record<string, string> = {};
  try {
    const paths = userDataPaths();
    const projectId = (state as { project?: { name?: string } }).project?.name ?? '';
    const refs = new WorkGraphService({ root: paths.root, worktreesDir: paths.worktrees, sideProjectsDir: paths.sideProjects }).resolveWorktrees(projectId);
    for (const ref of refs) {
      resolvedPaths[ref.repo] = ref.path;
    }
  } catch {
    // resolveWorktrees failure is non-fatal; paths will be empty string
  }
  return scRepos.map(r => {
    const entry: Record<string, unknown> = {
      name: r.name,
      path: resolvedPaths[r.name] ?? '',
      branch: r.branch,
    };
    if (perRepoSha) {
      const sha = perRepoSha(r);
      if (sha != null) {
        entry.head_sha = sha;
      } else {
        entry.head_sha = null;
      }
    }
    return entry;
  });
}

/**
 * Repo names from `pipeline.source_control.repos[]`, in state order — the same
 * list the per-repo mutations match reported rows against by name, so it is the
 * only correct source for a repos-array skeleton. Name-only by design: unlike
 * `buildReposArray` it does no worktree resolution.
 */
export function repoNamesFromState(state: PipelineState): string[] {
  return (state.pipeline.source_control?.repos ?? []).map(r => r.name);
}

/**
 * Enriches a raw walker result with action-specific context fields.
 * Returns the enriched context object matching v4's exact shapes.
 */
export function enrichActionContext(input: EnrichmentInput): Record<string, unknown> {
  const { action, walkerContext, state } = input;

  // Planning spawn enrichment — map the action to its planner step. The
  // orchestrator inlines `step` into the spawn prompt directly.
  if (action in PLANNING_SPAWN_STEPS) {
    return { ...walkerContext, step: PLANNING_SPAWN_STEPS[action] };
  }

  // Phase-level enrichment
  if (PHASE_LEVEL_ACTIONS.has(action)) {
    const phaseNumber = resolveActivePhaseIndex(state);
    const phase_id = formatPhaseId(phaseNumber);
    const base: Record<string, unknown> = { ...walkerContext, phase_number: phaseNumber, phase_id };

    if (action === 'spawn_phase_reviewer') {
      const phaseLoop = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
      const phaseIter = phaseLoop?.iterations[phaseNumber - 1];

      const taskLoop = phaseIter?.nodes['task_loop'] as ForEachTaskNodeState | undefined;
      const taskIters = taskLoop?.iterations ?? [];

      // Accumulate every commit per repo across the whole phase, in
      // traversal order (task order, each task's own commit then its
      // correctives, then the phase's own correctives last — correctives
      // fire only after all task iterations complete, so they are always
      // chronologically last within the phase). A task only ever targets
      // one repo (Master Plan "one repo per task" policy), so looking only
      // at the first/last task iteration silently drops any other repo the
      // phase touched — this must scan every iteration, mirroring
      // spawn_final_reviewer's per-repo accumulation below.
      const commitsByRepo = new Map<string, string[]>();
      const pushCommit = (repoName: string, commitHash: string | null) => {
        if (commitHash == null) return;
        const bucket = commitsByRepo.get(repoName) ?? [];
        bucket.push(commitHash);
        commitsByRepo.set(repoName, bucket);
      };
      for (const taskIter of taskIters) {
        for (const r of taskIter.repos ?? []) {
          pushCommit(r.name, r.commit_hash);
        }
        for (const ct of taskIter.corrective_tasks ?? []) {
          for (const r of ct.repos ?? []) {
            pushCommit(r.name, r.commit_hash);
          }
        }
      }
      for (const ct of phaseIter?.corrective_tasks ?? []) {
        for (const r of ct.repos ?? []) {
          pushCommit(r.name, r.commit_hash);
        }
      }

      // Canonical corrective_index: the latest corrective's own `.index`, not
      // the array length (reconciled to CorrectiveTaskEntry.index — the same
      // derivation execute_task and spawn_code_reviewer use). This corrective
      // branch is provably unreachable via the walker (phase review is
      // single-pass), so this is hygiene/future-proofing.
      const lastPhaseCorrective = phaseIter && phaseIter.corrective_tasks.length > 0
        ? phaseIter.corrective_tasks[phaseIter.corrective_tasks.length - 1]
        : undefined;
      const correctiveFields = lastPhaseCorrective
        ? { is_correction: true, corrective_index: lastPhaseCorrective.index }
        : {};

      // Build repos[] with path/branch from buildReposArray, then attach per-repo phase SHAs.
      const repos = buildReposArray(state).map(entry => {
        const commits = commitsByRepo.get(entry.name as string) ?? [];
        return {
          ...entry,
          phase_first_sha: commits.length > 0 ? commits[0] : null,
          phase_head_sha: commits.length > 0 ? commits[commits.length - 1] : null,
        };
      });

      return { ...base, repos, phase_plan_doc: phaseIter?.doc_path ?? null, ...correctiveFields };
    }

    return base;
  }

  // Task-level enrichment
  if (TASK_LEVEL_ACTIONS.has(action)) {
    // Final-scope-first: a step-hosted corrective (e.g. on `final_review`) owns
    // no phase/task iteration at all, so it must be resolved before — and
    // instead of — the phase_loop-anchored resolution below (which would throw
    // once every phase has completed, exactly the state a final corrective
    // runs in). Mirrors the phase-scope-first / task-scope sentinel pattern
    // that follows, but for a corrective with no owning iteration.
    const activeFinal = resolveActiveFinalCorrective(state);
    if (activeFinal) {
      const { entry, budgetOrigin } = activeFinal;
      // Phase identity is genuinely absent for a final corrective — nothing
      // here belongs to a phase iteration. Both nulls must survive to the
      // envelope untouched; do not substitute a placeholder phase number.
      const base: Record<string, unknown> = {
        ...walkerContext,
        phase_number: null,
        phase_id: null,
        task_number: null,
        task_id: 'FINAL',
      };

      if (action === 'execute_task') {
        const repos = buildReposArray(state);
        if (repos.length === 0) {
          throw new Error(
            `Cannot enrich execute_task for the active final corrective: no repos resolved ` +
            `(pipeline.source_control is not initialized). Run source-control init ` +
            `(rad-execute Step 3 — 'radorch source-control init --project <name>') ` +
            `before executing tasks.`
          );
        }
        const scForCommit = state.pipeline.source_control;
        const should_commit = scForCommit != null && scForCommit.auto_commit !== 'never';
        // handoff_doc is omitted entirely (not set to null) — its absence is
        // what the reviewer's and coder's contracts key off.
        return {
          ...base,
          repos,
          complexity: 'standard',
          should_commit,
          ...correctiveReportFields(entry, budgetOrigin),
        };
      }

      if (action === 'spawn_code_reviewer') {
        const sourceRepos = entry.repos;
        // handoff_doc omitted — same rationale as execute_task above.
        return {
          ...base,
          repos: buildReposArray(state, r => sourceRepos.find(sr => sr.name === r.name)?.commit_hash ?? null),
          complexity: 'standard',
          is_correction: true,
          ...correctiveReportFields(entry, budgetOrigin),
        };
      }

      return base; // gate_task
    }

    const phaseNumber = resolveActivePhaseIndex(state);
    const taskNumber = resolveActiveTaskIndex(state, phaseNumber);
    const phase_id = formatPhaseId(phaseNumber);
    const task_id = formatTaskId(phaseNumber, taskNumber);
    const base: Record<string, unknown> = {
      ...walkerContext,
      phase_number: phaseNumber,
      phase_id,
      task_number: taskNumber,
      task_id,
    };

    // Iter 11 — phase-scope corrective sentinel. When a phase-scope corrective
    // is active (last entry on phaseIter.corrective_tasks with status
    // `not_started` or `in_progress`), override `task_number` to null and
    // `task_id` to `${phase_id}-PHASE`. This propagates through to the
    // coder/reviewer spawn contexts so the scope identity is self-describing
    // in logs and to downstream consumers, without a task number that doesn't
    // exist for this corrective.
    const phaseLoopForSentinel = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
    const phaseIterForSentinel = phaseLoopForSentinel?.iterations[phaseNumber - 1];
    const phaseCorrectives = phaseIterForSentinel?.corrective_tasks ?? [];
    const phaseCorrectiveActive = phaseCorrectives.length > 0 &&
      (phaseCorrectives[phaseCorrectives.length - 1].status === 'not_started' ||
       phaseCorrectives[phaseCorrectives.length - 1].status === 'in_progress');
    if (phaseCorrectiveActive) {
      base.task_number = null;
      base.task_id = `${phase_id}-PHASE`;
    }

    if (action === 'execute_task') {
      // Source-control must be initialized before any task executes — the
      // convention-derived repos[] is the coder's only source of a working
      // path. An empty array means `pipeline.source_control` was never
      // populated (init skipped), so fail loud here instead of handing the
      // coder no working directory and letting the run die silently.
      const repos = buildReposArray(state);
      if (repos.length === 0) {
        throw new Error(
          `Cannot enrich execute_task for ${phase_id}/${task_id}: no repos resolved ` +
          `(pipeline.source_control is not initialized). Run source-control init ` +
          `(rad-execute Step 3 — 'radorch source-control init --project <name>') ` +
          `before executing tasks.`
        );
      }

      const phaseLoop = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
      const phaseIter = phaseLoop?.iterations[phaseNumber - 1];

      // Surface the authored complexity signal of the active task iteration so
      // the coder spawn routes to the correct tier. Defaults to `standard` when
      // the iteration carries no signal (e.g. phase-scope correctives).
      const taskLoopForComplexity = phaseIter?.nodes['task_loop'] as ForEachTaskNodeState | undefined;
      const complexity = taskLoopForComplexity?.iterations[taskNumber - 1]?.complexity ?? 'standard';

      // Whether the coder should commit its work, derived from the sealed
      // source-control policy: no source control (null) or `never` turns commit
      // off; any other value ('always') turns it on. Rides the envelope as a
      // sibling to `complexity` so the orchestrator can shape the coder's spawn
      // prompt. Push is inferred at runtime from repo remote presence, so there
      // is no should_push counterpart. Kept identical to the `task_completed`
      // mutation's `commitExpected` so the two never disagree on the null case.
      const scForCommit = state.pipeline.source_control;
      const should_commit = scForCommit != null && scForCommit.auto_commit !== 'never';

      // Iter 11 — phase-scope-first. When a phase-scope corrective is active
      // (last entry on phaseIter.corrective_tasks with status `not_started` or
      // `in_progress`), route handoff_doc to that corrective's pre-completed
      // `task_handoff` sub-node. Checked BEFORE the task-scope corrective path
      // so a phase-scope corrective's handoff takes precedence even when the
      // underlying task iteration itself has correctives.
      const phaseCTs = phaseIter?.corrective_tasks ?? [];
      const activePhaseCorrective = phaseCTs.length > 0 ? phaseCTs[phaseCTs.length - 1] : undefined;
      if (
        activePhaseCorrective &&
        (activePhaseCorrective.status === 'not_started' || activePhaseCorrective.status === 'in_progress')
      ) {
        const phaseCorrectiveDoc = activePhaseCorrective.doc_path;
        if (typeof phaseCorrectiveDoc === 'string' && phaseCorrectiveDoc.trim().length > 0) {
          // Return the stored path unchanged (not the trimmed copy) so downstream
          // consumers see the value exactly as the mutation wrote it.
          return { ...base, handoff_doc: phaseCorrectiveDoc, repos, complexity, should_commit, ...correctiveReportFields(activePhaseCorrective) };
        }
      }

      const taskLoop = phaseIter?.nodes['task_loop'] as ForEachTaskNodeState | undefined;
      const taskIter = taskLoop?.iterations[taskNumber - 1];

      // Iter 10 — when a task-scope corrective is active (last entry with
      // status `not_started` or `in_progress`), route handoff_doc to the
      // corrective's pre-completed `task_handoff` sub-node instead of the
      // original iteration's. Completed correctives fall through to the
      // original handoff — they don't route subsequent execution.
      const correctives = taskIter?.corrective_tasks ?? [];
      const activeCorrective = correctives.length > 0
        ? correctives[correctives.length - 1]
        : undefined;
      if (
        activeCorrective &&
        (activeCorrective.status === 'not_started' || activeCorrective.status === 'in_progress')
      ) {
        const correctiveDoc = activeCorrective.doc_path;
        if (typeof correctiveDoc === 'string' && correctiveDoc.trim().length > 0) {
          // Return the stored path unchanged (not the trimmed copy) so downstream
          // consumers see the value exactly as the mutation wrote it.
          return { ...base, handoff_doc: correctiveDoc, repos, complexity, should_commit, ...correctiveReportFields(activeCorrective) };
        }
      }

      const handoff_doc = taskIter?.doc_path ?? '';
      return { ...base, handoff_doc, repos, complexity, should_commit };
    }

    if (action === 'spawn_code_reviewer') {
      const phaseLoop = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
      const phaseIter = phaseLoop?.iterations[phaseNumber - 1];

      // Mirror execute_task's complexity derivation verbatim (including the quirk
      // that it always reads the base task iteration's signal, defaulting to
      // `standard`) so the reviewer tier routes consistently with the coder tier.
      const taskLoopForComplexity = phaseIter?.nodes['task_loop'] as ForEachTaskNodeState | undefined;
      const complexity = taskLoopForComplexity?.iterations[taskNumber - 1]?.complexity ?? 'standard';

      // Iter 11 — phase-scope-first. When a phase-scope corrective is active,
      // route repos[].head_sha to the phase-scope corrective's per-repo commit hashes
      // and flag is_correction + report fields from phaseIter. Checked BEFORE the
      // task-scope corrective path. handoff_doc is the phase iteration's original
      // scope doc.
      const phaseCTs = phaseIter?.corrective_tasks ?? [];
      const activePhaseCorrective = phaseCTs.slice().reverse().find(
        ct => ct.status === 'in_progress' || ct.status === 'not_started'
      );
      if (activePhaseCorrective) {
        const sourceRepos = activePhaseCorrective.repos;
        return {
          ...base,
          repos: buildReposArray(state, r => sourceRepos.find(sr => sr.name === r.name)?.commit_hash ?? null),
          complexity,
          handoff_doc: phaseIter?.doc_path ?? null,
          is_correction: true,
          ...correctiveReportFields(activePhaseCorrective),
        };
      }

      const taskLoop = phaseIter?.nodes['task_loop'] as ForEachTaskNodeState | undefined;
      const taskIter = taskLoop?.iterations[taskNumber - 1];
      const correctives = taskIter?.corrective_tasks ?? [];
      const activeCorrective = correctives.slice().reverse().find(
        ct => ct.status === 'in_progress' || ct.status === 'not_started'
      );
      const sourceRepos = activeCorrective ? activeCorrective.repos : (taskIter?.repos ?? []);
      const correctiveFields = activeCorrective
        ? { is_correction: true, ...correctiveReportFields(activeCorrective) }
        : {};
      return {
        ...base,
        repos: buildReposArray(state, r => sourceRepos.find(sr => sr.name === r.name)?.commit_hash ?? null),
        complexity,
        handoff_doc: taskIter?.doc_path ?? null,
        ...correctiveFields,
      };
    }

    return base;
  }

  // Source control enrichment
  if (action === 'invoke_source_control_pr') {
    // Derive per-repo entries with fresh absolute paths via buildReposArray —
    // never read a stored path. Merges base_branch from sc repos (required by
    // the source-control skill's PR context contract).
    const scReposForPr = state.pipeline.source_control?.repos ?? [];
    const repos = buildReposArray(state).map(r => ({
      ...r,
      base_branch: scReposForPr.find(sc => sc.name === r.name)?.base_branch ?? null,
    }));

    return {
      ...walkerContext,
      repos,
    };
  }

  if (action === 'request_final_approval') {
    return {
      ...walkerContext,
      repos: (state.pipeline.source_control?.repos ?? []).map(r => ({ name: r.name, pr_url: r.pr_url ?? null })),
    };
  }

  // spawn_final_reviewer enrichment. Derive per-repo diff SHAs from iteration
  // commit hashes across the whole pipeline. Commits are accumulated per repo,
  // in a Map keyed by repo name, by walking phases in index order → tasks in
  // index order → task-correctives in index order → phase-correctives (per
  // phase), then step-hosted correctives last. That walk order is a traversal
  // convenience only, not a chronology: an amendment can reopen `phase_loop`
  // and add new phase/task commits after a step-hosted corrective has already
  // completed, so the corrective's commit — appended last by walk order — can
  // be chronologically *older* than commits the walk places before it.
  // `project_base_sha` and `project_head_sha` are therefore read off the
  // accumulated list only after it is reordered by the repo's real git
  // history, not off the walk order's first/last positions. Both null when no
  // commits exist (auto-commit=off).
  if (action === 'spawn_final_reviewer') {
    const phaseLoop = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
    const commitsByRepo = new Map<string, string[]>();
    const phaseIterations = phaseLoop?.iterations ?? [];
    for (const phaseIter of phaseIterations) {
      const taskLoop = phaseIter.nodes['task_loop'] as ForEachTaskNodeState | undefined;
      const taskIterations = taskLoop?.iterations ?? [];
      for (const taskIter of taskIterations) {
        for (const r of taskIter.repos ?? []) {
          if (r.commit_hash != null) {
            const bucket = commitsByRepo.get(r.name) ?? [];
            bucket.push(r.commit_hash);
            commitsByRepo.set(r.name, bucket);
          }
        }
        for (const ct of taskIter.corrective_tasks ?? []) {
          for (const r of ct.repos ?? []) {
            if (r.commit_hash != null) {
              const bucket = commitsByRepo.get(r.name) ?? [];
              bucket.push(r.commit_hash);
              commitsByRepo.set(r.name, bucket);
            }
          }
        }
      }
      // Phase correctives are appended after task commits because phase_review
      // fires only after all task iterations complete, making phase correctives
      // chronologically last within a phase.
      for (const ct of phaseIter.corrective_tasks ?? []) {
        for (const r of ct.repos ?? []) {
          if (r.commit_hash != null) {
            const bucket = commitsByRepo.get(r.name) ?? [];
            bucket.push(r.commit_hash);
            commitsByRepo.set(r.name, bucket);
          }
        }
      }
    }

    // Step-hosted corrective commits (e.g. a final corrective on `final_review`)
    // are appended after the phase/task walk above. A final corrective is
    // ordinarily the last thing to happen in a run, but an amendment can reopen
    // `phase_loop` afterward, so this walk position is never assumed to be
    // chronologically last — the accumulated list is reordered by real git
    // history below. Accumulate the whole array, not the spent window — a
    // re-review after an approval-gate rejection must still see the corrective
    // work the rejection was meant to re-examine.
    for (const node of Object.values(state.graph.nodes)) {
      if (node.kind !== 'step') continue;
      for (const ct of (node as StepNodeState).corrective_tasks ?? []) {
        for (const r of ct.repos ?? []) {
          if (r.commit_hash != null) {
            const bucket = commitsByRepo.get(r.name) ?? [];
            bucket.push(r.commit_hash);
            commitsByRepo.set(r.name, bucket);
          }
        }
      }
    }

    // For each repo with at least one accumulated commit, resolve the repo's
    // real commit ancestry via `git rev-list` (using that repo's own worktree
    // path as the git cwd) and validate every commit is reachable in it,
    // before reading off the base/head extremes — walk order alone is not
    // chronology, since an amendment can reopen `phase_loop` behind an
    // already-completed step-hosted corrective. A single accumulated commit
    // still needs this same readability/reachability check — a corrupted
    // hash, a rewritten history, or a stale worktree path is exactly as
    // unusable with one commit as with many — so only the reorder step is
    // skipped for it (there is nothing to order against a single element).
    // Zero commits (auto-commit off) skips git entirely: there is no commit
    // to validate, and skipping avoids spawning a subprocess needlessly.
    const reposArray = buildReposArray(state);
    const rangeByRepo = new Map<string, { base: string | null; head: string | null }>();
    for (const entry of reposArray) {
      const repoName = entry.name as string;
      const commits = commitsByRepo.get(repoName) ?? [];
      if (commits.length === 0) {
        rangeByRepo.set(repoName, { base: null, head: null });
        continue;
      }

      const repoPath = entry.path as string;
      if (!repoPath) {
        return {
          ...walkerContext,
          error:
            `Repo '${repoName}': could not resolve a worktree path for this repo, so its commit history ` +
            `cannot be checked. Confirm 'source-control init' was run for this project and the repo is ` +
            `registered with a resolvable worktree, then re-run.`,
        };
      }
      const ordinal = new Map<string, number>();
      let gitFailure: string | null = null;
      try {
        const stdout = execFileSync('git', ['rev-list', '--topo-order', '--reverse', 'HEAD'], {
          cwd: repoPath,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        });
        stdout.split('\n').map((s: string) => s.trim()).filter(Boolean).forEach((sha: string, i: number) => {
          ordinal.set(sha, i + 1);
        });
      } catch (err) {
        gitFailure = err instanceof Error ? err.message : String(err);
      }

      if (ordinal.size === 0) {
        return {
          ...walkerContext,
          error:
            `This repository's commit history could not be read, so its commit range cannot be ordered. ` +
            `Repo: '${repoName}'. Path checked: '${repoPath}'. Underlying git error: ${gitFailure ?? 'no commits were found'}. ` +
            `Confirm this path points to an existing, valid git checkout — it may be a stale or moved ` +
            `worktree path recorded in the project's state, or a directory that is not a git repository — ` +
            `then re-run.`,
        };
      }

      const unreachableError = validateCommitsReachableFromHead(commits, ordinal, repoName, repoPath);
      if (unreachableError) {
        return { ...walkerContext, error: unreachableError };
      }

      if (commits.length === 1) {
        rangeByRepo.set(repoName, { base: commits[0], head: commits[0] });
        continue;
      }

      // Every commit is already confirmed resolvable (and unambiguous) by the
      // check above, so resolve each one's ordinal position once into a
      // parallel array rather than re-resolving it inside the sort comparator
      // on every comparison.
      const positioned = commits.map(commit => {
        const resolution = resolveOrdinalPosition(ordinal, commit);
        if (resolution.status !== 'resolved') {
          throw new Error(
            `Internal error: commit '${commit}' failed to resolve after passing reachability validation.`
          );
        }
        return { commit, position: resolution.position };
      });
      positioned.sort((a, b) => a.position - b.position);
      rangeByRepo.set(repoName, { base: positioned[0].commit, head: positioned[positioned.length - 1].commit });
    }

    // Build repos[] with per-repo base/head SHAs.
    const repos = reposArray.map(entry => {
      const repoName = entry.name as string;
      const range = rangeByRepo.get(repoName) ?? { base: null, head: null };
      return {
        ...entry,
        project_base_sha: range.base,
        project_head_sha: range.head,
      };
    });

    // Scope docs for the final review: the pre-pipeline requirements doc
    // (work-graph-resolved; null when unresolved) and every phase plan path.
    const requirements_doc = resolveRequirementsDoc(state.project.name);
    const phase_plan_paths = phaseIterations.map(pi => pi.doc_path ?? null);

    return {
      ...walkerContext,
      repos,
      requirements_doc,
      phase_plan_paths,
    };
  }

  // Empty-context actions — passthrough walkerContext unchanged
  if (EMPTY_CONTEXT_ACTIONS.has(action)) {
    return { ...walkerContext };
  }

  if (action === 'display_halted') {
    return {
      ...walkerContext,
      details: walkerContext.details ?? `Pipeline halted at node: ${state.graph.current_node_path ?? 'unknown'}`,
    };
  }

  // Unknown action — passthrough unchanged
  return { ...walkerContext };
}
