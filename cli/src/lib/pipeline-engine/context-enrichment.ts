import { execFileSync } from 'node:child_process';
import { userDataPaths } from '../paths.js';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import type {
  PipelineState,
  OrchestrationConfig,
  EventContext,
  ForEachPhaseNodeState,
  ForEachTaskNodeState,
  StepNodeState,
} from './types.js';

/**
 * Validate that `commits[0]` is the chronologically earliest commit according
 * to the git-history ordinal map. Returns an error string when the invariant
 * is violated (FR-7), or null when everything is fine.
 *
 * @param commits - Traversal-ordered list of short SHAs (8-char prefix).
 * @param ordinal - Map from short SHA to 1-based chronological position
 *                  (lower = older) derived from `git rev-list --topo-order --reverse`.
 * @param repoName - Optional repo name to include in the violation message (FR-4).
 */
export function validateBaseShaChronology(
  commits: string[],
  ordinal: Map<string, number>,
  repoName?: string,
): string | null {
  if (commits.length === 0) return null;
  const base = commits[0];
  const baseOrd = ordinal.get(base);
  if (baseOrd === undefined) return null; // unknown to git history — leave to other checks
  for (const c of commits) {
    const o = ordinal.get(c);
    if (o !== undefined && o < baseOrd) {
      const repoPrefix = repoName ? `repo '${repoName}': ` : '';
      return (
        `${repoPrefix}project_base_sha chronology violation: selected base '${base}' (git position ${baseOrd}) ` +
        `is not the earliest commit — '${c}' (git position ${o}) precedes it. ` +
        `A poisoned commit_hash likely contaminated base derivation.`
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
      const firstTask = taskIters[0];
      const lastTask = taskIters[taskIters.length - 1];

      // Build per-repo arrays for first/last SHA lookup.
      const firstTaskRepos = firstTask?.repos ?? [];
      // For the last task, prefer the final corrective's repos (if any commit exists), then the task's own repos.
      const lastTaskFinalCorrective = lastTask?.corrective_tasks
        .slice()
        .reverse()
        .find(ct => ct.repos.some(r => r.commit_hash != null));
      const lastTaskRepos = lastTaskFinalCorrective?.repos ?? lastTask?.repos ?? [];

      const correctiveFields = phaseIter && phaseIter.corrective_tasks.length > 0
        ? { is_correction: true, corrective_index: phaseIter.corrective_tasks.length }
        : {};

      // Build repos[] with path/branch from buildReposArray, then attach per-repo phase SHAs.
      const repos = buildReposArray(state).map(entry => ({
        ...entry,
        phase_first_sha: firstTaskRepos.find(fr => fr.name === entry.name)?.commit_hash ?? null,
        phase_head_sha: (
          lastTaskRepos.slice().reverse().find(lr => lr.name === entry.name && lr.commit_hash != null)?.commit_hash ?? null
        ),
      }));

      return { ...base, repos, ...correctiveFields };
    }

    return base;
  }

  // Task-level enrichment
  if (TASK_LEVEL_ACTIONS.has(action)) {
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
    // coder/reviewer spawn contexts so the correct filename sentinel
    // (`-PHASE-C{N}.md`) is derivable and the value is self-describing in logs.
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
          return { ...base, handoff_doc: phaseCorrectiveDoc, repos, complexity };
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
          return { ...base, handoff_doc: correctiveDoc, repos, complexity };
        }
      }

      const handoff_doc = taskIter?.doc_path ?? '';
      return { ...base, handoff_doc, repos, complexity };
    }

    if (action === 'spawn_code_reviewer') {
      const phaseLoop = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
      const phaseIter = phaseLoop?.iterations[phaseNumber - 1];

      // Iter 11 — phase-scope-first. When a phase-scope corrective is active,
      // route repos[].head_sha to the phase-scope corrective's per-repo commit hashes
      // and flag is_correction + corrective_index from phaseIter. Checked BEFORE the
      // task-scope corrective path.
      const phaseCTs = phaseIter?.corrective_tasks ?? [];
      const activePhaseCorrective = phaseCTs.slice().reverse().find(
        ct => ct.status === 'in_progress' || ct.status === 'not_started'
      );
      if (activePhaseCorrective) {
        const sourceRepos = activePhaseCorrective.repos;
        return {
          ...base,
          repos: buildReposArray(state, r => sourceRepos.find(sr => sr.name === r.name)?.commit_hash ?? null),
          is_correction: true,
          corrective_index: activePhaseCorrective.index,
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
        ? { is_correction: true, corrective_index: activeCorrective.index }
        : {};
      return {
        ...base,
        repos: buildReposArray(state, r => sourceRepos.find(sr => sr.name === r.name)?.commit_hash ?? null),
        ...correctiveFields,
      };
    }

    return base;
  }

  // Source control enrichment
  if (action === 'invoke_source_control_commit') {
    const phaseNumber = resolveActivePhaseIndex(state);
    const taskNumber = resolveActiveTaskIndex(state, phaseNumber);
    const phase_id = formatPhaseId(phaseNumber);

    let task_number: number | null = taskNumber;
    let task_id = formatTaskId(phaseNumber, taskNumber);

    const phaseLoopForSentinel = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
    const phaseIterForSentinel = phaseLoopForSentinel?.iterations[phaseNumber - 1];
    const phaseCorrectives = phaseIterForSentinel?.corrective_tasks ?? [];
    const phaseCorrectiveActive = phaseCorrectives.length > 0 &&
      (phaseCorrectives[phaseCorrectives.length - 1].status === 'not_started' ||
       phaseCorrectives[phaseCorrectives.length - 1].status === 'in_progress');
    if (phaseCorrectiveActive) {
      task_number = null;
      task_id = `${phase_id}-PHASE`;
    }

    // Derive per-repo entries with fresh absolute paths via buildReposArray —
    // never read a stored path. Merges base_branch from sc repos (required by
    // the source-control skill's commit context contract).
    const scReposForCommit = state.pipeline.source_control?.repos ?? [];
    const repos = buildReposArray(state).map(r => ({
      ...r,
      base_branch: scReposForCommit.find(sc => sc.name === r.name)?.base_branch ?? null,
    }));

    return {
      ...walkerContext,
      phase_number: phaseNumber,
      phase_id,
      task_number,
      task_id,
      repos,
    };
  }

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

  // Iter 12 — spawn_final_reviewer enrichment. Derive per-repo diff SHAs from
  // iteration commit hashes across the whole pipeline. Traversal order: phases
  // in index order → tasks in index order → task-correctives in index order →
  // then phase-correctives (per phase). Commits are accumulated per repo in a
  // Map keyed by repo name. `project_base_sha` is the first commit for that
  // repo; `project_head_sha` is the last. The pipeline invariant ensures phase
  // correctives always land after all task commits within a phase. Both null
  // when no commits exist (auto-commit=off). FR-3: per-repo grouping.
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

    // FR-4: For each repo with > 1 commits, validate chronology using that
    // repo's own worktree path as the git cwd. A chronology violation requires
    // at least two commits to order against each other, so skip the rev-list
    // invocation entirely for 0–1 commits (the check cannot fail there, and
    // skipping it avoids spawning a subprocess when auto-commit is off). NFR-4.
    const reposArray = buildReposArray(state);
    for (const entry of reposArray) {
      const repoName = entry.name as string;
      const commits = commitsByRepo.get(repoName) ?? [];
      if (commits.length > 1) {
        const repoPath = (entry.path as string) || process.cwd();
        let ordinal = new Map<string, number>();
        try {
          const stdout = execFileSync('git', ['rev-list', '--topo-order', '--reverse', 'HEAD'], {
            cwd: repoPath,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
          });
          stdout.split('\n').map((s: string) => s.trim()).filter(Boolean).forEach((sha: string, i: number) => {
            ordinal.set(sha.slice(0, 8), i + 1);
          });
        } catch {
          ordinal = new Map();
        }
        const chronologyError = validateBaseShaChronology(
          commits.map((c: string) => c.slice(0, 8)),
          ordinal,
          repoName,
        );
        if (chronologyError) {
          return { ...walkerContext, error: chronologyError };
        }
      }
    }

    // Build repos[] with per-repo base/head SHAs.
    const repos = reposArray.map(entry => {
      const repoName = entry.name as string;
      const commits = commitsByRepo.get(repoName) ?? [];
      return {
        ...entry,
        project_base_sha: commits.length > 0 ? commits[0] : null,
        project_head_sha: commits.length > 0 ? commits[commits.length - 1] : null,
      };
    });

    return {
      ...walkerContext,
      repos,
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
