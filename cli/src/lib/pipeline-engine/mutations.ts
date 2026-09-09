import type {
  PipelineState,
  NodeState,
  StepNodeState,
  GateNodeState,
  MutationFn,
  MutationResult,
  IterationEntry,
  CorrectiveTaskEntry,
  RepoCommitEntry,
  StepNodeDef,
  NodeDef,
  ForEachPhaseNodeState,
  ParseErrorDetail,
  PipelineTemplate,
} from './types.js';
import { EVENTS, VALID_VERDICTS, REVIEW_VERDICTS } from './constants.js';
import { scaffoldNodeState, findTaskLoopBodyDefs } from './scaffold.js';
import {
  resolveActivePhaseIndex,
  resolveActiveTaskIndex,
  resolveActiveFinalCorrective,
  type ActiveFinalCorrective,
} from './context-enrichment.js';

// ── Per-repo commit signal shape ──────────────────────────────────────────────

interface SignalRepoRow {
  name: string;
  committed: boolean;
  commitHash: string | null;
  pushed: boolean;
}

// ── Hash-overwrite guard ──────────────────────────────────────────────────────

// Hash-equal (allow) vs hash-differs (reject) idempotency rule. Reads the
// durable existing hash on the specific entry being written; refuses to
// overwrite a non-null hash with a different non-null value. Null existing
// hash (first write) and equal incoming hash (idempotent retry) are allowed.
function assertHashWritable(entry: RepoCommitEntry, incoming: string | null): void {
  const existing = entry.commit_hash;
  if (existing != null && incoming != null && existing !== incoming) {
    throw new Error(
      `task_completed refused: would overwrite a finalized commit_hash ` +
      `('${existing}' → '${incoming}') on an already-recorded entry. ` +
      `A finalized commit hash is immutable; the incoming signal addresses the wrong entry or carries a stale context.`
    );
  }
}

// ── Per-repo commit hash apply helper ────────────────────────────────────────

/**
 * For each entry in signalRepos, finds or creates the matching entry in repos
 * by name and sets commit_hash when committed=true. A committed=false row with
 * no commitHash is a no-op (clean skip — never a rejection). A committed=false
 * row that nonetheless carries a commitHash is malformed (a real commit whose
 * `committed` flag was dropped in relay) and is rejected loudly — a well-formed
 * commit report guarantees committed:false ⇒ commitHash:null, so this only
 * fires on a mis-relayed payload.
 */
function applyPerRepoCommitHashes(
  repos: RepoCommitEntry[],
  signalRepos: SignalRepoRow[],
  mutations_applied: string[],
  label: string,
): void {
  for (const row of signalRepos) {
    if (!row.committed) {
      if (row.commitHash != null) {
        throw new Error(
          `task_completed refused: repo '${row.name}' carries commitHash ` +
          `'${row.commitHash}' but committed is false/absent. A committed row must set ` +
          `committed:true — relay the coder's result array verbatim ` +
          `(every field of each row, including committed).`
        );
      }
      continue; // clean skip — nothing was committed for this repo
    }
    // committed:true must carry a real hash. A null/empty hash on a committed row
    // would silently record no hash, collapsing the reviewer's diff scope to
    // `git diff HEAD`. A well-formed commit report never emits this (committed ⇒
    // commitHash), so it only fires on a mis-relayed payload — reject it loudly,
    // symmetric with the committed:false-with-hash guard above.
    if (row.commitHash == null || row.commitHash === '') {
      throw new Error(
        `task_completed refused: repo '${row.name}' reports committed:true but carries no ` +
        `commit hash (commitHash is ${row.commitHash === '' ? 'empty' : 'null'}). A committed ` +
        `repo must report its commit hash — relay the coder's result array verbatim ` +
        `(every field of each row, including commitHash).`
      );
    }
    let entry = repos.find(r => r.name === row.name);
    if (!entry) {
      entry = { name: row.name, commit_hash: null };
      repos.push(entry);
    }
    assertHashWritable(entry, row.commitHash);
    entry.commit_hash = row.commitHash;
    mutations_applied.push(`set ${label}[name=${row.name}].commit_hash = ${row.commitHash ?? 'null'}`);
  }
}

// ── On-branch record-time guard (R3 / Security) ──────────────────────────────

/**
 * Refuses to record a commit that a committed row reports on a branch other than
 * that repo's intended task branch (sealed in source_control). This is the
 * record-time catch-net behind the coder's pre-commit on-branch check: it hardens
 * the record path against a stale or misrouted signal that would attach a
 * wrong-branch commit to the iteration. committed:false rows are not checked.
 * When the signal relays no branch the guard is a no-op — the coder's commit step
 * is the primary gate; this only fires when a branch is present to compare.
 */
function assertReposOnBranch(
  state: PipelineState,
  signalRepos: SignalRepoRow[],
  reportedBranch: string | undefined,
): void {
  if (reportedBranch === undefined || reportedBranch === '') return;
  const scRepos = state.pipeline.source_control?.repos ?? [];
  for (const row of signalRepos) {
    if (!row.committed) continue;
    const intended = scRepos.find(sc => sc.name === row.name)?.branch;
    if (intended != null && intended !== '' && reportedBranch !== intended) {
      throw new Error(
        `task_completed refused: repo '${row.name}' reports a commit on branch ` +
        `'${reportedBranch}' but its intended task branch is '${intended}'. A commit off ` +
        `the intended branch is refused at record time — the coder commits on its own task ` +
        `branch in its own worktree.`
      );
    }
  }
}

// ── Resolution scope ──────────────────────────────────────────────────────────

type ResolveScope = 'top' | 'phase' | 'task' | 'final';

// ── resolveNodeState ──────────────────────────────────────────────────────────

export function resolveNodeState(
  state: PipelineState,
  nodeId: string,
  scope: ResolveScope,
  phase?: number,
  task?: number
): NodeState {
  if (scope === 'top') {
    return state.graph.nodes[nodeId];
  }

  if (scope === 'final') {
    const active = resolveActiveFinalCorrective(state);
    if (!active) {
      throw new Error(
        `resolveNodeState: scope is 'final' but no active final corrective exists on state.`
      );
    }
    return active.entry.nodes[nodeId];
  }

  if (phase === undefined) {
    throw new Error(`resolveNodeState: scope is '${scope}' but phase is undefined`);
  }

  const phaseLoopNode = state.graph.nodes['phase_loop'];
  if (phaseLoopNode.kind !== 'for_each_phase') {
    throw new Error(`Expected phase_loop to be a for_each_phase node, got ${phaseLoopNode.kind}`);
  }
  const phaseIteration = phaseLoopNode.iterations[phase - 1];

  if (scope === 'phase') {
    return phaseIteration.nodes[nodeId];
  }

  // scope === 'task'
  // Phase-level corrective tasks (born from phase_review_completed on a
  // changes_requested verdict) carry pre-seeded task-body nodes (scaffolded via
  // findTaskLoopBodyDefs). This check DOES hit for an active phase-scope
  // corrective — mutations targeting `task`-scope nodes during a phase-scope
  // corrective's body walk resolve to that corrective's `nodes` map. Task-level
  // corrective tasks (from code_review_completed) likewise populate nodes.
  // Legacy empty-nodes entries from older state snapshots (not expected in new
  // runs) still fall through cleanly because `nodeId in latest.nodes` is false.
  if (phaseIteration.corrective_tasks.length > 0) {
    const latest = phaseIteration.corrective_tasks[phaseIteration.corrective_tasks.length - 1];
    if ((latest.status === 'in_progress' || latest.status === 'not_started') && nodeId in latest.nodes) {
      return latest.nodes[nodeId];
    }
  }

  const taskLoopNode = phaseIteration.nodes['task_loop'];
  if (taskLoopNode.kind !== 'for_each_task') {
    throw new Error(`Expected task_loop to be a for_each_task node, got ${taskLoopNode.kind}`);
  }
  const taskIteration = taskLoopNode.iterations[(task ?? 1) - 1];

  // Task-level corrective tasks: route mutations to the latest active corrective entry's nodes
  if (taskIteration.corrective_tasks.length > 0) {
    const latest = taskIteration.corrective_tasks[taskIteration.corrective_tasks.length - 1];
    if ((latest.status === 'in_progress' || latest.status === 'not_started') && nodeId in latest.nodes) {
      return latest.nodes[nodeId];
    }
  }

  return taskIteration.nodes[nodeId];
}

// ── Mutation registry ─────────────────────────────────────────────────────────

const mutationRegistry = new Map<string, MutationFn>();

// ── Planning _completed mutations ─────────────────────────────────────────────
//
// Per FR-11, no `*_started` mutation handlers exist. Step-node transitions to
// `in_progress` happen via the optimistic write in `processEvent` (FR-10) on
// the same writeState as the next-action emit. The `*_completed` handlers
// below are responsible for finishing the step and setting any per-step state
// (e.g. `doc_path`).

const planningCompletedSteps: Array<[string, string]> = [
  [EVENTS.MASTER_PLAN_COMPLETED, 'master_plan'],
];

for (const [eventName, nodeId] of planningCompletedSteps) {
  mutationRegistry.set(eventName, (state, context, _config, _template): MutationResult => {
    const cloned = structuredClone(state);
    const mutations_applied: string[] = [];

    const node = resolveNodeState(cloned, nodeId, 'top');
    node.status = 'completed';
    mutations_applied.push(`set ${nodeId}.status = completed`);

    const docPath = context.doc_path ?? null;
    (node as StepNodeState).doc_path = docPath;
    mutations_applied.push(`set ${nodeId}.doc_path = ${docPath ?? 'null'}`);

    return { state: cloned, mutations_applied };
  });
}

// ── explosion_completed mutation (clears parse-failure recovery state) ────────

mutationRegistry.set(EVENTS.EXPLOSION_COMPLETED, (state, _context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  const node = resolveNodeState(cloned, 'explode_master_plan', 'top');
  node.status = 'completed';
  mutations_applied.push('set explode_master_plan.status = completed');

  // Defensive: explicitly clear any stale doc_path on the explode node. The script
  // itself never writes a doc_path here (its output is phases/ + tasks/ + seeded
  // iterations, not a single doc), but a state.json produced by an older version
  // of this handler may carry a lingering value. Setting to null guarantees the
  // UI doesn't render a spurious "Doc" link on a re-run or after upgrade.
  (node as StepNodeState).doc_path = null;
  mutations_applied.push('set explode_master_plan.doc_path = null');

  // Clear any recovery state on master_plan — success wipes the slate.
  const masterPlanNode = resolveNodeState(cloned, 'master_plan', 'top') as StepNodeState;
  if (masterPlanNode.last_parse_error !== null && masterPlanNode.last_parse_error !== undefined) {
    masterPlanNode.last_parse_error = null;
    mutations_applied.push('cleared master_plan.last_parse_error');
  }
  masterPlanNode.parse_retry_count = 0;
  mutations_applied.push('reset master_plan.parse_retry_count = 0');

  return { state: cloned, mutations_applied };
});

// ── explosion_failed mutation (parse-failure recovery loop; cap=3) ────────────

// Hardcoded for Iter 5; configurability is Iter 14.
const MAX_PARSE_RETRIES = 3;

mutationRegistry.set(EVENTS.EXPLOSION_FAILED, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  const masterPlanNode = resolveNodeState(cloned, 'master_plan', 'top') as StepNodeState;
  const explodeNode = resolveNodeState(cloned, 'explode_master_plan', 'top') as StepNodeState;

  // context.parse_error carries { line, expected, found, message } from the explosion CLI wrapper.
  // Hard-error on missing / malformed parse_error — a dispatch-layer bug, not a recoverable parse
  // failure. Silently tolerating a null here would let retry_count climb toward the cap with
  // last_parse_error = null, yielding an "unknown parse error" halt that gives the planner
  // nothing actionable to fix.
  const parseError = context.parse_error as ParseErrorDetail | undefined;
  if (!parseError || !Number.isInteger(parseError.line) || parseError.line < 1 ||
      typeof parseError.expected !== 'string' ||
      typeof parseError.found !== 'string' ||
      typeof parseError.message !== 'string') {
    explodeNode.status = 'failed';
    explodeNode.doc_path = null;
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason =
      'Explosion dispatch error: explosion_failed received without a valid parse_error payload. ' +
      'This is a programmer error — the orchestrator or CLI wrapper must pass --parse-error with ' +
      '{ line, expected, found, message }.';
    mutations_applied.push('set explode_master_plan.status = failed (invalid dispatch)');
    mutations_applied.push('set explode_master_plan.doc_path = null (invalid dispatch)');
    mutations_applied.push('set graph.status = halted (dispatch error)');
    mutations_applied.push('set pipeline.halt_reason (dispatch error)');
    return { state: cloned, mutations_applied };
  }

  masterPlanNode.last_parse_error = parseError;
  mutations_applied.push(
    `set master_plan.last_parse_error = { line: ${parseError.line}, ... }`
  );

  const previousCount = masterPlanNode.parse_retry_count ?? 0;
  const nextCount = previousCount + 1;
  masterPlanNode.parse_retry_count = nextCount;
  mutations_applied.push(`set master_plan.parse_retry_count = ${nextCount}`);

  if (nextCount > MAX_PARSE_RETRIES) {
    // Cap exceeded — halt. The orchestrator surfaces this via the rad-log-error skill.
    explodeNode.status = 'failed';
    mutations_applied.push(`set explode_master_plan.status = failed (parse retry cap ${MAX_PARSE_RETRIES} exceeded)`);
    // Defensive: explicitly clear any stale doc_path on the explode node, mirroring the
    // idempotency fix in the explosion_completed path. An upgraded state.json may carry
    // a lingering value from an older handler; null guarantees the UI doesn't render
    // a spurious "Doc" link on the halted node.
    (explodeNode as StepNodeState).doc_path = null;
    mutations_applied.push('set explode_master_plan.doc_path = null');
    cloned.graph.status = 'halted';
    mutations_applied.push('set graph.status = halted');
    const reasonMsg = parseError.message;
    cloned.pipeline.halt_reason =
      `Explosion parser rejected planner output ${nextCount} times (cap=${MAX_PARSE_RETRIES}). ` +
      `Manual intervention required. Last error: ${reasonMsg}`;
    mutations_applied.push(`set pipeline.halt_reason (parse retry cap exceeded)`);
    return { state: cloned, mutations_applied };
  }

  // Recoverable — reset and re-spawn the planner.
  explodeNode.status = 'not_started';
  (explodeNode as StepNodeState).doc_path = null;
  mutations_applied.push('set explode_master_plan.status = not_started');
  mutations_applied.push('set explode_master_plan.doc_path = null (recovery reset)');
  masterPlanNode.status = 'in_progress';
  mutations_applied.push('set master_plan.status = in_progress (recovery re-spawn)');

  return { state: cloned, mutations_applied };
});

// ── Gate approved mutations ───────────────────────────────────────────────────

mutationRegistry.set(EVENTS.PLAN_APPROVED, (state, _context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];
  const node = resolveNodeState(cloned, 'plan_approval_gate', 'top');
  node.status = 'completed';
  (node as GateNodeState).gate_active = true;
  mutations_applied.push('set plan_approval_gate.status = completed');
  mutations_applied.push('set plan_approval_gate.gate_active = true');
  cloned.pipeline.current_tier = 'execution';
  mutations_applied.push('set pipeline.current_tier = execution');
  return { state: cloned, mutations_applied };
});

mutationRegistry.set(EVENTS.TASK_GATE_APPROVED, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];
  const node = resolveNodeState(cloned, 'task_gate', 'task', context.phase, context.task);
  node.status = 'completed';
  (node as GateNodeState).gate_active = true;
  mutations_applied.push('set task_gate.status = completed');
  mutations_applied.push('set task_gate.gate_active = true');
  return { state: cloned, mutations_applied };
});

mutationRegistry.set(EVENTS.PHASE_GATE_APPROVED, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];
  const node = resolveNodeState(cloned, 'phase_gate', 'phase', context.phase);
  node.status = 'completed';
  (node as GateNodeState).gate_active = true;
  mutations_applied.push('set phase_gate.status = completed');
  mutations_applied.push('set phase_gate.gate_active = true');
  return { state: cloned, mutations_applied };
});

mutationRegistry.set(EVENTS.FINAL_APPROVED, (state, _context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];
  const node = resolveNodeState(cloned, 'final_approval_gate', 'top');
  node.status = 'completed';
  (node as GateNodeState).gate_active = true;
  mutations_applied.push('set final_approval_gate.status = completed');
  mutations_applied.push('set final_approval_gate.gate_active = true');
  return { state: cloned, mutations_applied };
});

// ── phase_review_completed (stores doc_path + verdict, routes on verdict) ────

mutationRegistry.set(EVENTS.PHASE_REVIEW_COMPLETED, (state, context, config, template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  let phase = context.phase;
  if (phase === undefined) {
    try {
      phase = resolveActivePhaseIndex(cloned);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Cannot apply mutation for "phase_review_completed": failed to resolve the active phase from state.\n` +
        `${detail}\n` +
        `Pass --phase <N> to specify the phase explicitly.`
      );
    }
  }

  let node: NodeState;
  try {
    node = resolveNodeState(cloned, 'phase_review', 'phase', phase);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot apply mutation for "phase_review_completed": could not resolve phase_review for phase ${phase}.\n` +
      `${detail}\n` +
      `Pass --phase <N> to specify an existing phase explicitly.`
    );
  }
  node.status = 'completed';
  mutations_applied.push('set phase_review.status = completed');

  const docPath = context.doc_path ?? null;
  (node as StepNodeState).doc_path = docPath;
  mutations_applied.push(`set phase_review.doc_path = ${docPath ?? 'null'}`);

  const rawVerdict = context.verdict ?? null;

  // PO-4 — route entirely off the reviewer's raw verdict. A coder self-mediates
  // its own review; the main agent is a dumb router, so there is no
  // orchestrator-authored mediation contract to consult.
  (node as StepNodeState).verdict = rawVerdict;
  mutations_applied.push(`set phase_review.verdict = ${rawVerdict ?? 'null'}`);

  // Unknown-verdict halt — the reviewer's raw verdict must be a recognized value.
  if (rawVerdict !== null && !VALID_VERDICTS.has(rawVerdict as string)) {
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason = `Unrecognized verdict '${rawVerdict}' in phase_review_completed`;
    return {
      state: cloned,
      mutations_applied: [
        ...mutations_applied,
        `set graph.status = halted (unrecognized verdict '${rawVerdict}')`,
      ],
    };
  }

  if (rawVerdict === REVIEW_VERDICTS.CHANGES_REQUESTED) {
    // Phase review is single-pass — no ancestor resolution, no parent-corrective
    // finalization. Birth a corrective off the phase iteration directly.
    const iteration = resolvePhaseIteration(cloned, phase);
    const birth = buildCorrectiveBirth({
      correctiveTasks: iteration.corrective_tasks,
      maxRetries: config.limits.max_retries_per_task,
      scopeDocPath: iteration.doc_path,
      reviewReportPath: context.doc_path ?? null,
      injectedAfter: 'phase_review',
      reason: context.reason ?? 'Phase review requested changes',
      template,
    });

    if (!birth.ok) {
      iteration.status = 'halted';
      cloned.graph.status = 'halted';
      cloned.pipeline.halt_reason = birth.haltReason;
      mutations_applied.push('set phase_iteration.status = halted (corrective budget exhausted)');
      mutations_applied.push('set graph.status = halted');
      mutations_applied.push('set pipeline.halt_reason (corrective budget exhausted)');
      return { state: cloned, mutations_applied };
    }

    const entry = birth.entry;
    iteration.corrective_tasks.push(entry);
    mutations_applied.push(`injected phase corrective task ${entry.index} (changes_requested)`);
    mutations_applied.push(`set phase_corrective_task[${entry.index}].doc_path = ${entry.doc_path}`);
    mutations_applied.push(`set phase_corrective_task[${entry.index}].review_report_path = ${entry.review_report_path ?? 'null'}`);
    mutations_applied.push(`phase corrective_tasks.length = ${iteration.corrective_tasks.length}`);
  } else if (rawVerdict === REVIEW_VERDICTS.REJECTED) {
    const iteration = resolvePhaseIteration(cloned, phase);
    iteration.status = 'halted';
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason =
      `Phase review rejected: reviewer issued a 'rejected' verdict. ` +
      `Rejected verdicts halt the pipeline with no corrective cycle — no retry is attempted.`;
    mutations_applied.push('set phase_iteration.status = halted (rejected verdict)');
    mutations_applied.push('set graph.status = halted');
    mutations_applied.push('set pipeline.halt_reason (reviewer rejected verdict)');
  }
  // rawVerdict === approved falls through with no corrective birth.

  return { state: cloned, mutations_applied };
});

// ── task_completed ───────────────────────────────────────────────────────

mutationRegistry.set(EVENTS.TASK_COMPLETED, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  // Final-scope guard — checked first, before any phase resolution. During an
  // active final corrective every phase iteration has already completed and no
  // phase carries an active corrective, so resolveActivePhaseIndex would hit
  // its deliberate "refusing to guess" throw; short-circuiting here (outside
  // the try/catch below) keeps that resolver's honesty intact and keeps any
  // `task_completed refused:` guard thrown in this branch from being masked by
  // the generic phase/task disambiguation message (see P01-T03).
  const activeFinal: ActiveFinalCorrective | null = resolveActiveFinalCorrective(cloned);
  if (activeFinal) {
    const { entry } = activeFinal;

    const node = resolveNodeState(cloned, 'task_executor', 'final') as StepNodeState;
    node.status = 'completed';
    mutations_applied.push('set task_executor.status = completed (scope=final)');

    const signalRepos = (context.repos as SignalRepoRow[] | undefined) ?? [];
    const sc = cloned.pipeline.source_control;
    const commitExpected = sc != null && sc.auto_commit !== 'never';

    if (commitExpected && signalRepos.length === 0) {
      throw new Error(
        `task_completed refused: commit is enabled (auto_commit != never) but no per-repo ` +
        `result payload was relayed (repos[] is missing or empty). The signal must carry the ` +
        `coder's commit result array via --repos '<json>'; advancing without it would record ` +
        `zero commit hashes.`
      );
    }

    if (!commitExpected && signalRepos.length > 0) {
      throw new Error(
        `task_completed refused: commit is disabled (source_control is unset or ` +
        `auto_commit=never) but a per-repo result payload was relayed (repos[] is non-empty). ` +
        `In no-commit mode the signal must carry no --repos payload; refusing to record commit ` +
        `hashes for a task that was not directed to commit.`
      );
    }

    if (signalRepos.length > 0) {
      assertReposOnBranch(cloned, signalRepos, context.branch as string | undefined);
      applyPerRepoCommitHashes(
        entry.repos,
        signalRepos,
        mutations_applied,
        `final_corrective_task[${entry.index}].repos`,
      );
    }

    return { state: cloned, mutations_applied };
  }

  let phase = context.phase;
  if (phase === undefined) {
    try {
      phase = resolveActivePhaseIndex(cloned);
    } catch {
      throw new Error(
        `Cannot apply mutation for "task_completed": no active phase could be resolved from state.\n` +
        `Either no phase is currently in_progress, or multiple phases are in_progress simultaneously.\n` +
        `Pass --phase <N> to specify the phase explicitly.`
      );
    }
  }

  let task = context.task;
  if (task === undefined) {
    try {
      task = resolveActiveTaskIndex(cloned, phase);
    } catch {
      throw new Error(
        `Cannot apply mutation for "task_completed": no active task could be resolved from state for phase ${phase}.\n` +
        `Either no task is currently in_progress, or multiple tasks are in_progress simultaneously.\n` +
        `Pass --task <N> to specify the task explicitly.`
      );
    }
  }

  try {
    const node = resolveNodeState(cloned, 'task_executor', 'task', phase, task);
    node.status = 'completed';
    mutations_applied.push('set task_executor.status = completed');

    // ── Commit recording (R3) ─────────────────────────────────────────────
    // The coder owns its task's commit, so its per-repo hash is recorded here on
    // task_completed. Recording runs before code_review (which depends on
    // task_executor), so the reviewer's diff scope stays anchored to the hash.
    const signalRepos = (context.repos as SignalRepoRow[] | undefined) ?? [];
    const sc = cloned.pipeline.source_control;
    const commitExpected = sc != null && sc.auto_commit !== 'never';

    // When commit is on, the coder relays a per-repo result array — even a
    // "nothing changed" task sends committed:false rows, never an empty array.
    // An empty/missing payload on the commit path is a relay bug: advancing
    // would record zero hashes and collapse the reviewer's diff scope to
    // `git diff HEAD`. When commit is off (auto_commit=never) the task carries
    // no payload, so recording is skipped entirely — the commit-or-not policy
    // from source-control state, enforced here at record time.
    if (commitExpected && signalRepos.length === 0) {
      throw new Error(
        `task_completed refused: commit is enabled (auto_commit != never) but no per-repo ` +
        `result payload was relayed (repos[] is missing or empty). The signal must carry the ` +
        `coder's commit result array via --repos '<json>'; advancing without it would record ` +
        `zero commit hashes.`
      );
    }

    // Mirror of the guard above (R3 / contract). When commit is off — source_control
    // is unset, or auto_commit=never — the coder is directed to leave its work
    // uncommitted, so the task carries NO per-repo payload (see event.task_completed
    // and action.execute_task). A non-empty repos[] in no-commit mode is a relay bug:
    // recording hashes that should not exist would silently attach a commit to a task
    // the policy said not to commit. Refuse it loudly instead of masking the mis-relay.
    if (!commitExpected && signalRepos.length > 0) {
      throw new Error(
        `task_completed refused: commit is disabled (source_control is unset or ` +
        `auto_commit=never) but a per-repo result payload was relayed (repos[] is non-empty). ` +
        `In no-commit mode the signal must carry no --repos payload; refusing to record commit ` +
        `hashes for a task that was not directed to commit.`
      );
    }

    if (signalRepos.length > 0) {
      // Record-time on-branch catch-net (R3 / Security) — refuse a commit
      // reported off its intended task branch before it is recorded.
      assertReposOnBranch(cloned, signalRepos, context.branch as string | undefined);

      // Phase-scope-first routing: route the per-repo hashes to the active
      // phase-scope corrective, else the active task-scope corrective, else the
      // task iteration, matched by name. Each corrective round owns a fresh entry
      // (repos:[]), so a retried task records to its own entry and the
      // immutability guard never has to overwrite a finalized hash.
      const phaseIteration = resolvePhaseIteration(cloned, phase);
      const activePhaseCorrective = phaseIteration.corrective_tasks.slice().reverse().find(
        (ct: CorrectiveTaskEntry) => ct.status === 'in_progress' || ct.status === 'not_started'
      );
      if (activePhaseCorrective) {
        applyPerRepoCommitHashes(
          activePhaseCorrective.repos,
          signalRepos,
          mutations_applied,
          `phase_corrective_task[${activePhaseCorrective.index}].repos`,
        );
      } else {
        const taskIteration = resolveTaskIteration(cloned, phase, task);
        const activeCorrective = taskIteration.corrective_tasks.slice().reverse().find(
          (ct: CorrectiveTaskEntry) => ct.status === 'in_progress' || ct.status === 'not_started'
        );
        if (activeCorrective) {
          applyPerRepoCommitHashes(
            activeCorrective.repos,
            signalRepos,
            mutations_applied,
            `corrective_task[${activeCorrective.index}].repos`,
          );
        } else {
          applyPerRepoCommitHashes(
            taskIteration.repos,
            signalRepos,
            mutations_applied,
            `task_iteration[${taskIteration.index}].repos`,
          );
        }
      }
    }
  } catch (err) {
    // Re-throw the loud record-time guards (empty-payload, per-repo hash, and
    // on-branch — all sharing the `task_completed refused:` prefix) so they
    // surface as diagnosable rejections instead of being masked by the generic
    // node-resolution disambiguation below.
    if (err instanceof Error && /task_completed refused/i.test(err.message)) {
      throw err;
    }
    if (context.phase === undefined) {
      const phaseLoopNode = cloned.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
      const hasInProgressPhase = phaseLoopNode?.iterations?.some(it => it.status === 'in_progress');
      if (hasInProgressPhase) {
        throw new Error(
          `Cannot apply mutation for "task_completed": no active task could be resolved from state for phase ${phase}.\n` +
          `Either no task is currently in_progress, or multiple tasks are in_progress simultaneously.\n` +
          `Pass --task <N> to specify the task explicitly.`
        );
      }
      throw new Error(
        `Cannot apply mutation for "task_completed": no active phase could be resolved from state.\n` +
        `Either no phase is currently in_progress, or multiple phases are in_progress simultaneously.\n` +
        `Pass --phase <N> to specify the phase explicitly.`
      );
    }
    throw new Error(
      `Cannot apply mutation for "task_completed": no active task could be resolved from state for phase ${phase}.\n` +
      `Either no task is currently in_progress, or multiple tasks are in_progress simultaneously.\n` +
      `Pass --task <N> to specify the task explicitly.`
    );
  }

  return { state: cloned, mutations_applied };
});

// ── Private helpers for corrective injection ─────────────────────────────────

function resolvePhaseIteration(state: PipelineState, phase: number): IterationEntry {
  const phaseLoopNode = state.graph.nodes['phase_loop'];
  if (phaseLoopNode.kind !== 'for_each_phase') {
    throw new Error(`Expected phase_loop to be a for_each_phase node, got ${phaseLoopNode.kind}`);
  }
  return phaseLoopNode.iterations[phase - 1];
}

function resolveTaskIteration(state: PipelineState, phase: number, task: number): IterationEntry {
  const phaseLoopNode = state.graph.nodes['phase_loop'];
  if (phaseLoopNode.kind !== 'for_each_phase') {
    throw new Error(`Expected phase_loop to be a for_each_phase node, got ${phaseLoopNode.kind}`);
  }
  const phaseIteration = phaseLoopNode.iterations[phase - 1];
  const taskLoopNode = phaseIteration.nodes['task_loop'];
  if (taskLoopNode.kind !== 'for_each_task') {
    throw new Error(`Expected task_loop to be a for_each_task node, got ${taskLoopNode.kind}`);
  }
  return taskLoopNode.iterations[task - 1];
}

interface CorrectiveBirthParams {
  /** The hosting iteration's corrective_tasks array (read-only here; caller pushes the entry). */
  correctiveTasks: CorrectiveTaskEntry[];
  /** Budget cap — the sole corrective gate. */
  maxRetries: number;
  /** ORIGINAL scope doc (hosting iteration's doc_path). Immutable; carried onto the corrective. */
  scopeDocPath: string | null | undefined;
  /** Review report that requested the correction (the completing review's doc_path). */
  reviewReportPath: string | null | undefined;
  /** Node ID that triggered injection (e.g. "code_review" | "phase_review"). */
  injectedAfter: string;
  /** Human-readable injection reason. */
  reason: string;
  /** Template, for scaffolding the corrective's task-loop-body nodes. */
  template: PipelineTemplate;
  /** Entries preceding the budget window; the gate measures within it. Default 0. */
  budgetOrigin?: number;
  /** When false, an absent scopeDocPath yields doc_path: null instead of throwing. Default true. */
  scopeDocRequired?: boolean;
}

type CorrectiveBirthResult =
  | { ok: true; entry: CorrectiveTaskEntry }
  | { ok: false; haltReason: string };

/**
 * Scope-agnostic corrective birth. Enforces the sole budget gate — measured
 * within the caller's budget window (`correctiveTasks.length - budgetOrigin >=
 * maxRetries` → halt; `budgetOrigin` defaults to 0, the whole-array gate every
 * pre-existing caller keeps) — and, when within budget, scaffolds a fresh
 * corrective entry carrying the ORIGINAL scope doc, the requesting review
 * report, and a 1-based index (globally contiguous across the budget window,
 * so the validator's existing index check is unaffected).
 *
 * An empty `scopeDocPath` is an engine invariant violation for a scope that
 * requires one (every task/phase iteration is seeded with a doc_path at
 * explosion), so it throws rather than halting — `processEvent`'s catch turns
 * the throw into a clean `{ error }` envelope with no state written, which is
 * the correct outcome for a programmer bug. A step-hosted corrective (e.g.
 * final_review) carries no iteration doc, so its caller passes
 * `scopeDocRequired: false` and an absent scope doc yields `doc_path: null`.
 */
function buildCorrectiveBirth(params: CorrectiveBirthParams): CorrectiveBirthResult {
  const {
    correctiveTasks, maxRetries, scopeDocPath, reviewReportPath, injectedAfter, reason, template,
    budgetOrigin = 0, scopeDocRequired = true,
  } = params;

  let resolvedScopeDocPath: string | null;
  if (typeof scopeDocPath !== 'string' || scopeDocPath.trim().length === 0) {
    if (scopeDocRequired) {
      throw new Error(
        `buildCorrectiveBirth: scopeDocPath is empty — every iteration is seeded with a doc_path at ` +
        `explosion, so an empty scope doc is an engine bug (not operator-recoverable). ` +
        `injected_after=${injectedAfter}.`
      );
    }
    resolvedScopeDocPath = null;
  } else {
    resolvedScopeDocPath = scopeDocPath;
  }

  const correctiveCount = correctiveTasks.length;
  const windowedCount = correctiveCount - budgetOrigin;
  if (windowedCount >= maxRetries) {
    return {
      ok: false,
      haltReason:
        `Corrective retry budget exhausted (windowed_corrective_count=${windowedCount}, ` +
        `max_retries_per_task=${maxRetries}). No further corrective task will be injected — ` +
        `the pipeline halts for manual intervention.`,
    };
  }

  const bodyDefs = findTaskLoopBodyDefs(template);
  if (bodyDefs.length === 0) {
    throw new Error('findTaskLoopBodyDefs: no for_each_task body found in template');
  }
  const nodes: Record<string, NodeState> = {};
  for (const bodyDef of bodyDefs) {
    nodes[bodyDef.id] = scaffoldNodeState(bodyDef);
  }

  const entry: CorrectiveTaskEntry = {
    index: correctiveCount + 1,
    reason,
    injected_after: injectedAfter,
    status: 'not_started',
    nodes,
    doc_path: resolvedScopeDocPath,
    review_report_path:
      typeof reviewReportPath === 'string' && reviewReportPath.trim().length > 0
        ? reviewReportPath
        : null,
    repos: [],
  };
  return { ok: true, entry };
}

/**
 * Iter 11 — ancestor-derivation for corrective-of-corrective routing.
 *
 * When a code_review completes with changes_requested, the birthed corrective
 * must append to the iteration that owns the completed code_review node:
 *
 *   - If the code_review node lives under an active phase-scope corrective
 *     (i.e. `phaseIter.corrective_tasks[last].nodes['code_review']`), the new
 *     corrective appends to `phaseIter.corrective_tasks`.
 *   - Otherwise (the code_review node lives under `taskIter.nodes` or
 *     `taskIter.corrective_tasks[K].nodes`), the new corrective appends to
 *     `taskIter.corrective_tasks` — iter-10 task-scope behaviour preserved.
 *
 * This is a pure ancestor lookup: no new event fields, no orchestrator-authored
 * scope hint. It generalizes cleanly to a future final-review scope.
 */
function resolveHostingIteration(
  state: PipelineState,
  phase: number,
  task: number
): { iteration: IterationEntry; scope: 'task' | 'phase' } {
  const phaseIter = resolvePhaseIteration(state, phase);
  const phaseCTs = phaseIter.corrective_tasks;
  if (phaseCTs.length > 0) {
    const last = phaseCTs[phaseCTs.length - 1];
    if (
      (last.status === 'in_progress' || last.status === 'not_started') &&
      'code_review' in last.nodes
    ) {
      return { iteration: phaseIter, scope: 'phase' };
    }
  }
  return { iteration: resolveTaskIteration(state, phase, task), scope: 'task' };
}

// ── code_review_completed (stores doc_path + verdict, routes on verdict) ──────

mutationRegistry.set(EVENTS.CODE_REVIEW_COMPLETED, (state, context, config, template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  // Final-scope branch — checked before phase/task resolution below, since a
  // final-review-hosted corrective lives outside phase_loop entirely and
  // resolveActivePhaseIndex must never be attempted against it (see P01-T03).
  const activeFinal: ActiveFinalCorrective | null = resolveActiveFinalCorrective(cloned);
  if (activeFinal) {
    const { host, entry, budgetOrigin } = activeFinal;

    const node = resolveNodeState(cloned, 'code_review', 'final') as StepNodeState;
    node.status = 'completed';
    mutations_applied.push('set code_review.status = completed (scope=final)');

    const docPath = context.doc_path ?? null;
    node.doc_path = docPath;
    mutations_applied.push(`set code_review.doc_path = ${docPath ?? 'null'} (scope=final)`);

    const rawVerdict = context.verdict ?? null;
    node.verdict = rawVerdict;
    mutations_applied.push(`set code_review.verdict = ${rawVerdict ?? 'null'} (scope=final)`);

    if (rawVerdict !== null && !VALID_VERDICTS.has(rawVerdict as string)) {
      cloned.graph.status = 'halted';
      cloned.pipeline.halt_reason = `Unrecognized verdict '${rawVerdict}' in code_review_completed`;
      return {
        state: cloned,
        mutations_applied: [
          ...mutations_applied,
          `set graph.status = halted (unrecognized verdict '${rawVerdict}')`,
        ],
      };
    }

    if (rawVerdict === REVIEW_VERDICTS.APPROVED) {
      // The cycle's outcome is written onto the host; the walker (P01-T04) is
      // what flips host.status to completed.
      host.verdict = 'approved';
      mutations_applied.push('set final_review.verdict = approved');
      cloned.pipeline.current_tier = 'review';
      mutations_applied.push('set pipeline.current_tier = review');
      return { state: cloned, mutations_applied };
    }

    if (rawVerdict === REVIEW_VERDICTS.CHANGES_REQUESTED) {
      // Corrective-of-a-corrective: same guard as the task/phase-scope branch
      // below — finalize the superseded predecessor entry before birthing its
      // successor as a flat sibling on the same host.
      if (entry.status !== 'completed' && entry.nodes['code_review']?.status === 'completed') {
        entry.status = 'completed';
        mutations_applied.push(
          `finalized superseded corrective_task[${entry.index}].status = completed (corrective-of-corrective, scope=final)`
        );
      }

      host.corrective_tasks ??= [];
      const birth = buildCorrectiveBirth({
        correctiveTasks: host.corrective_tasks,
        maxRetries: config.limits.max_retries_per_task,
        budgetOrigin,
        scopeDocPath: null,
        scopeDocRequired: false,
        reviewReportPath: context.doc_path ?? null,
        injectedAfter: 'code_review',
        reason: context.reason ?? 'Code review requested changes',
        template,
      });

      if (!birth.ok) {
        host.status = 'halted';
        cloned.graph.status = 'halted';
        cloned.pipeline.halt_reason = birth.haltReason;
        mutations_applied.push('set final_review.status = halted (corrective budget exhausted, scope=final)');
        mutations_applied.push('set graph.status = halted');
        mutations_applied.push('set pipeline.halt_reason (corrective budget exhausted)');
        return { state: cloned, mutations_applied };
      }

      const newEntry = birth.entry;
      host.corrective_tasks.push(newEntry);
      mutations_applied.push(`injected corrective task ${newEntry.index} (changes_requested, scope=final)`);
      mutations_applied.push(`set corrective_task[${newEntry.index}].doc_path = ${newEntry.doc_path ?? 'null'}`);
      mutations_applied.push(`set corrective_task[${newEntry.index}].review_report_path = ${newEntry.review_report_path ?? 'null'}`);
      mutations_applied.push(`corrective_tasks.length = ${host.corrective_tasks.length} (scope=final)`);
      return { state: cloned, mutations_applied };
    }

    if (rawVerdict === REVIEW_VERDICTS.REJECTED) {
      host.status = 'halted';
      cloned.graph.status = 'halted';
      cloned.pipeline.halt_reason =
        `Code review rejected (scope=final): reviewer issued a 'rejected' verdict. ` +
        `Rejected verdicts halt the pipeline with no corrective cycle — no retry is attempted.`;
      mutations_applied.push('set final_review.status = halted (rejected verdict, scope=final)');
      mutations_applied.push('set graph.status = halted');
      mutations_applied.push('set pipeline.halt_reason (reviewer rejected verdict)');
      return { state: cloned, mutations_applied };
    }

    // rawVerdict === null: no recognized route — fall through with the record
    // already written and no status change.
    return { state: cloned, mutations_applied };
  }

  let phase = context.phase;
  if (phase === undefined) {
    try {
      phase = resolveActivePhaseIndex(cloned);
    } catch {
      throw new Error(
        `Cannot apply mutation for "code_review_completed": no active phase could be resolved from state.\n` +
        `Either no phase is currently in_progress, or multiple phases are in_progress simultaneously.\n` +
        `Pass --phase <N> to specify the phase explicitly.`
      );
    }
  }

  let task = context.task;
  if (task === undefined) {
    try {
      task = resolveActiveTaskIndex(cloned, phase);
    } catch {
      throw new Error(
        `Cannot apply mutation for "code_review_completed": no active task could be resolved from state for phase ${phase}.\n` +
        `Either no task is currently in_progress, or multiple tasks are in_progress simultaneously.\n` +
        `Pass --task <N> to specify the task explicitly.`
      );
    }
  }

  // Base behavior: always mark code_review completed with doc_path and verdict
  let node: NodeState;
  try {
    node = resolveNodeState(cloned, 'code_review', 'task', phase, task);
  } catch {
    throw new Error(
      `Cannot apply mutation for "code_review_completed": failed to resolve code_review node for phase ${phase}, task ${task}.\n` +
      `Either no task is currently in_progress, or multiple tasks are in_progress simultaneously.\n` +
      `Pass --phase <N> and/or --task <N> to specify explicitly.`
    );
  }
  node.status = 'completed';
  mutations_applied.push('set code_review.status = completed');

  const docPath = context.doc_path ?? null;
  (node as StepNodeState).doc_path = docPath;
  mutations_applied.push(`set code_review.doc_path = ${docPath ?? 'null'}`);

  const rawVerdict = context.verdict ?? null;

  // PO-4 — route entirely off the reviewer's raw verdict. A coder self-mediates
  // its own review; the main agent is a dumb router, so there is no
  // orchestrator-authored mediation contract to consult.
  (node as StepNodeState).verdict = rawVerdict;
  mutations_applied.push(`set code_review.verdict = ${rawVerdict ?? 'null'}`);

  // Unknown-verdict halt — the reviewer's raw verdict must be a recognized value.
  if (rawVerdict !== null && !VALID_VERDICTS.has(rawVerdict as string)) {
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason = `Unrecognized verdict '${rawVerdict}' in code_review_completed`;
    return {
      state: cloned,
      mutations_applied: [
        ...mutations_applied,
        `set graph.status = halted (unrecognized verdict '${rawVerdict}')`,
      ],
    };
  }

  if (rawVerdict === REVIEW_VERDICTS.CHANGES_REQUESTED) {
    // Ancestor-derivation. When the completed code_review lives under an active
    // phase-scope corrective, the new corrective appends to
    // phaseIter.corrective_tasks; otherwise it appends to taskIter (task-scope
    // behaviour).
    const { iteration, scope } = resolveHostingIteration(cloned, phase, task);

    // Corrective-of-a-corrective: when the code_review that just completed lives
    // on the hosting iteration's most recent corrective entry, that parent
    // corrective is now superseded — its review concluded (changes_requested)
    // and a successor corrective takes over. Finalize the parent here, BEFORE
    // birthing the child. The walker only ever finalizes the LATEST corrective,
    // so without this the parent is stranded at in_progress inside a
    // later-completed iteration (the HICCUP-TEST symptom). Uses the hosting
    // iteration, so it covers both task-scope and phase-scope correctives
    // uniformly. An empty array (the first corrective, born from an original
    // task's code_review) is a no-op. phase_review_completed needs no equivalent
    // guard: phase_review is single-pass and never fires on a corrective, so it
    // has no parent corrective to finalize.
    const existingCorrectives = iteration.corrective_tasks;
    if (existingCorrectives.length > 0) {
      const parent = existingCorrectives[existingCorrectives.length - 1];
      if (parent.status !== 'completed' && parent.nodes['code_review']?.status === 'completed') {
        parent.status = 'completed';
        mutations_applied.push(
          `finalized superseded corrective_task[${parent.index}].status = completed (corrective-of-corrective, scope=${scope})`
        );
      }
    }

    const birth = buildCorrectiveBirth({
      correctiveTasks: iteration.corrective_tasks,
      maxRetries: config.limits.max_retries_per_task,
      scopeDocPath: iteration.doc_path,
      reviewReportPath: context.doc_path ?? null,
      injectedAfter: 'code_review',
      reason: context.reason ?? 'Code review requested changes',
      template,
    });

    if (!birth.ok) {
      iteration.status = 'halted';
      cloned.graph.status = 'halted';
      cloned.pipeline.halt_reason = birth.haltReason;
      mutations_applied.push(`set ${scope}_iteration.status = halted (corrective budget exhausted, scope=${scope})`);
      mutations_applied.push('set graph.status = halted');
      mutations_applied.push('set pipeline.halt_reason (corrective budget exhausted)');
      return { state: cloned, mutations_applied };
    }

    const entry = birth.entry;
    iteration.corrective_tasks.push(entry);
    mutations_applied.push(`injected corrective task ${entry.index} (changes_requested, scope=${scope})`);
    mutations_applied.push(`set corrective_task[${entry.index}].doc_path = ${entry.doc_path}`);
    mutations_applied.push(`set corrective_task[${entry.index}].review_report_path = ${entry.review_report_path ?? 'null'}`);
    mutations_applied.push(`corrective_tasks.length = ${iteration.corrective_tasks.length} (scope=${scope})`);
  } else if (rawVerdict === REVIEW_VERDICTS.REJECTED) {
    // The rejected verdict halts the hosting iteration, not a stale-default task
    // iteration. When a phase-scope corrective's code review returns `rejected`,
    // halt the phase iteration (its ancestor). Uses the same ancestor-derivation
    // helper the `changes_requested` branch uses.
    const { iteration, scope } = resolveHostingIteration(cloned, phase, task);
    iteration.status = 'halted';
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason =
      `Code review rejected (scope=${scope}): reviewer issued a 'rejected' verdict. ` +
      `Rejected verdicts halt the pipeline with no corrective cycle — no retry is attempted.`;
    mutations_applied.push(`set ${scope === 'phase' ? 'phase_iteration' : 'task_iteration'}.status = halted (rejected verdict, scope=${scope})`);
    mutations_applied.push('set graph.status = halted');
    mutations_applied.push('set pipeline.halt_reason (reviewer rejected verdict)');
  }
  // rawVerdict === approved falls through with no corrective birth.

  return { state: cloned, mutations_applied };
});

// ── Final review mutations ────────────────────────────────────────────────────

/**
 * Finds a step node's def anywhere in the template tree (top level or nested
 * under a for_each/conditional/parallel body), by id. Used to read
 * `hosts_correctives` off the running template snapshot rather than assuming
 * it's declared (a per-project snapshot may predate the declaration).
 */
function findStepNodeDef(nodes: NodeDef[], id: string): StepNodeDef | undefined {
  for (const nodeDef of nodes) {
    if (nodeDef.id === id) {
      return nodeDef.kind === 'step' ? nodeDef : undefined;
    }
    if (nodeDef.kind === 'for_each_phase' || nodeDef.kind === 'for_each_task') {
      const found = findStepNodeDef(nodeDef.body, id);
      if (found) return found;
    }
    if (nodeDef.kind === 'conditional') {
      const found = findStepNodeDef(nodeDef.branches.true, id) ?? findStepNodeDef(nodeDef.branches.false, id);
      if (found) return found;
    }
    if (nodeDef.kind === 'parallel') {
      const found = findStepNodeDef(nodeDef.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

mutationRegistry.set(EVENTS.FINAL_REVIEW_COMPLETED, (state, context, config, template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  // Record first, then route — doc_path is written before any branch so the
  // report is reachable from the dashboard while correction is underway.
  const node = resolveNodeState(cloned, 'final_review', 'top') as StepNodeState;

  const docPath = context.doc_path ?? null;
  node.doc_path = docPath;
  mutations_applied.push(`set final_review.doc_path = ${docPath ?? 'null'}`);

  const rawVerdict = context.verdict ?? null;
  node.verdict = rawVerdict;
  mutations_applied.push(`set final_review.verdict = ${rawVerdict ?? 'null'}`);

  if (rawVerdict !== null && !VALID_VERDICTS.has(rawVerdict as string)) {
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason = `Unrecognized verdict '${rawVerdict}' in final_review_completed`;
    return {
      state: cloned,
      mutations_applied: [
        ...mutations_applied,
        `set graph.status = halted (unrecognized verdict '${rawVerdict}')`,
      ],
    };
  }

  if (rawVerdict === REVIEW_VERDICTS.APPROVED) {
    node.status = 'completed';
    mutations_applied.push('set final_review.status = completed');
    cloned.pipeline.current_tier = 'review';
    mutations_applied.push('set pipeline.current_tier = review');
    return { state: cloned, mutations_applied };
  }

  if (rawVerdict === REVIEW_VERDICTS.CHANGES_REQUESTED) {
    // Do not complete the node — a corrective cycle is opening, not closing.
    node.status = 'in_progress';
    mutations_applied.push('set final_review.status = in_progress');

    const stepDef = findStepNodeDef(template.nodes, 'final_review');
    if (stepDef?.hosts_correctives !== true) {
      node.status = 'halted';
      cloned.graph.status = 'halted';
      cloned.pipeline.halt_reason =
        `Final review requested changes but the running template's 'final_review' node declares no ` +
        `corrective host (hosts_correctives is not true). This project is running a per-project ` +
        `template snapshot that predates final-scope corrective support; the snapshot does not ` +
        `self-heal. Add 'hosts_correctives: true' to that project's own template snapshot, or accept ` +
        `that this project has no final-scope corrective path.`;
      mutations_applied.push('set final_review.status = halted (stale template snapshot: no hosts_correctives)');
      mutations_applied.push('set graph.status = halted');
      mutations_applied.push('set pipeline.halt_reason (stale template snapshot)');
      return { state: cloned, mutations_applied };
    }

    node.corrective_tasks ??= [];
    const budgetOrigin = node.corrective_budget_origin ?? 0;
    const birth = buildCorrectiveBirth({
      correctiveTasks: node.corrective_tasks,
      maxRetries: config.limits.max_retries_per_task,
      budgetOrigin,
      scopeDocPath: null,
      scopeDocRequired: false,
      reviewReportPath: context.doc_path ?? null,
      injectedAfter: 'final_review',
      reason: context.reason ?? 'Final review requested changes',
      template,
    });

    if (!birth.ok) {
      node.status = 'halted';
      cloned.graph.status = 'halted';
      cloned.pipeline.halt_reason = birth.haltReason;
      mutations_applied.push('set final_review.status = halted (corrective budget exhausted)');
      mutations_applied.push('set graph.status = halted');
      mutations_applied.push('set pipeline.halt_reason (corrective budget exhausted)');
      return { state: cloned, mutations_applied };
    }

    const entry = birth.entry;
    node.corrective_tasks.push(entry);
    mutations_applied.push(`injected final corrective task ${entry.index} (changes_requested)`);
    mutations_applied.push(`set final_corrective_task[${entry.index}].doc_path = ${entry.doc_path ?? 'null'}`);
    mutations_applied.push(`set final_corrective_task[${entry.index}].review_report_path = ${entry.review_report_path ?? 'null'}`);
    mutations_applied.push(`final corrective_tasks.length = ${node.corrective_tasks.length}`);

    // The corrective was born successfully and the pipeline keeps running — it
    // is still in the review stage, not execution. Only this success exit
    // promotes; both halting exits above leave current_tier untouched.
    cloned.pipeline.current_tier = 'review';
    mutations_applied.push('set pipeline.current_tier = review');
    return { state: cloned, mutations_applied };
  }

  if (rawVerdict === REVIEW_VERDICTS.REJECTED) {
    node.status = 'halted';
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason =
      `Final review rejected: reviewer issued a 'rejected' verdict. ` +
      `Rejected verdicts halt the pipeline with no corrective cycle — no retry is attempted.`;
    mutations_applied.push('set final_review.status = halted (rejected verdict)');
    mutations_applied.push('set graph.status = halted');
    mutations_applied.push('set pipeline.halt_reason (reviewer rejected verdict)');
    return { state: cloned, mutations_applied };
  }

  // rawVerdict === null: no recognized route — fall through with the record
  // already written and no status change.
  return { state: cloned, mutations_applied };
});


// ── Source control PR mutations (final_pr as top-scoped sibling) ──────────────

mutationRegistry.set(EVENTS.PR_REQUESTED, (state, _context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  if (!cloned.graph.nodes['final_pr']) {
    cloned.graph.nodes['final_pr'] = scaffoldNodeState({
      id: 'final_pr',
      kind: 'step',
      action: 'invoke_source_control_pr',
      events: { started: 'pr_requested', completed: 'pr_created' },
    } as StepNodeDef);
    mutations_applied.push('scaffold final_pr (was not yet initialized)');
  }

  const node = resolveNodeState(cloned, 'final_pr', 'top');
  node.status = 'in_progress';
  mutations_applied.push('set final_pr.status = in_progress');

  return { state: cloned, mutations_applied };
});

mutationRegistry.set(EVENTS.PR_CREATED, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  const node = resolveNodeState(cloned, 'final_pr', 'top');
  node.status = 'completed';
  mutations_applied.push('set final_pr.status = completed');

  // FR-9, FR-10, AD-4 — array-shaped per-repo signal. The PR CLI emits a
  // [{name, pr_url}] result array; fan each pr_url into the matching
  // source_control.repos[] entry by name, creating a stub entry when absent.
  // No top-level pr_url is written (FR-9 removes that field).
  const signalRepos = (context.repos as Array<{ name: string; pr_url: string | null }> | undefined) ?? [];
  if (signalRepos.length > 0) {
    if (!cloned.pipeline.source_control) {
      throw new Error(
        'pr_created: pipeline.source_control is null — cannot store pr_url. ' +
        'Source control must be initialized before PR creation.'
      );
    }
    const scRepos = cloned.pipeline.source_control.repos;
    for (const row of signalRepos) {
      let entry = scRepos.find(r => r.name === row.name);
      if (!entry) {
        entry = {
          name: row.name,
          branch: '',
          base_branch: '',
          remote_url: null,
          compare_url: null,
          pr_url: null,
        };
        scRepos.push(entry);
      }
      entry.pr_url = row.pr_url ?? null;
      mutations_applied.push(`set source_control.repos[name=${row.name}].pr_url = ${row.pr_url ?? 'null'}`);
    }
  }

  return { state: cloned, mutations_applied };
});

// ── plan_rejected mutation ────────────────────────────────────────────────────

mutationRegistry.set(EVENTS.PLAN_REJECTED, (state, _context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  const masterPlanNode = resolveNodeState(cloned, 'master_plan', 'top');
  masterPlanNode.status = 'not_started';
  mutations_applied.push('set master_plan.status = not_started');
  (masterPlanNode as StepNodeState).doc_path = null;
  mutations_applied.push('set master_plan.doc_path = null');

  const planGateNode = resolveNodeState(cloned, 'plan_approval_gate', 'top');
  planGateNode.status = 'not_started';
  mutations_applied.push('set plan_approval_gate.status = not_started');
  (planGateNode as GateNodeState).gate_active = false;
  mutations_applied.push('set plan_approval_gate.gate_active = false');

  // phase_loop is only present on templates that declare it (default.yml, full.yml).
  // Planning-only templates (no phase_loop declared) treat plan_rejected as a
  // legitimate exit path, so skip the reset silently.
  const phaseLoopNode = cloned.graph.nodes['phase_loop'];
  if (phaseLoopNode !== undefined) {
    if (phaseLoopNode.kind !== 'for_each_phase') {
      throw new Error(`Expected phase_loop to be a for_each_phase node, got ${phaseLoopNode.kind}`);
    }
    phaseLoopNode.iterations = [];
    mutations_applied.push('set phase_loop.iterations = []');
  }

  return { state: cloned, mutations_applied };
});

// ── gate_rejected mutation ────────────────────────────────────────────────────

mutationRegistry.set(EVENTS.GATE_REJECTED, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  cloned.pipeline.current_tier = 'halted';
  mutations_applied.push('set pipeline.current_tier = halted');

  cloned.graph.status = 'halted';
  mutations_applied.push('set graph.status = halted');

  const gateType = context.gate_type ?? 'unknown';
  // Intentional: use || (not ??) so that an empty-string reason also falls back to the default.
  // The halt mutation uses ?? because an explicit empty string is a valid operator-supplied reason.
  const reason = context.reason || 'No reason provided';
  cloned.pipeline.halt_reason = `Gate rejected (${gateType}): ${reason}`;
  mutations_applied.push(`set pipeline.halt_reason = Gate rejected (${gateType}): ${reason}`);

  return { state: cloned, mutations_applied };
});

// ── final_corrective_requested mutation ───────────────────────────────────────

mutationRegistry.set(EVENTS.FINAL_CORRECTIVE_REQUESTED, (state, context, config, template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  const reason = typeof context.reason === 'string' ? context.reason.trim() : '';
  if (reason.length === 0) {
    throw new Error(
      'final_corrective_requested requires --reason: the confirmed write-up is the whole content ' +
      'of the request — it becomes the review report\'s finding and the corrective\'s reason.'
    );
  }

  const node = resolveNodeState(cloned, 'final_review', 'top') as StepNodeState;

  const stepDef = findStepNodeDef(template.nodes, 'final_review');
  if (stepDef?.hosts_correctives !== true) {
    node.status = 'halted';
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason =
      `The operator requested a change at the final approval gate, but the running template's ` +
      `'final_review' node declares no corrective host (hosts_correctives is not true). This project ` +
      `is running a per-project template snapshot that predates final-scope corrective support; the ` +
      `snapshot does not self-heal. Add 'hosts_correctives: true' to that project's own template ` +
      `snapshot, or accept that this project has no final-scope corrective path.`;
    mutations_applied.push('set final_review.status = halted (stale template snapshot: no hosts_correctives)');
    mutations_applied.push('set graph.status = halted');
    mutations_applied.push('set pipeline.halt_reason (stale template snapshot)');
    return { state: cloned, mutations_applied };
  }

  node.corrective_tasks ??= [];

  // An operator request is new information, not a failed retry, so it must not
  // draw down the budget an agent loop spends. Advancing the origin to the
  // current length opens a fresh window, leaving the gate to measure only the
  // agent work this request triggers.
  const budgetOrigin = node.corrective_tasks.length;
  node.corrective_budget_origin = budgetOrigin;
  mutations_applied.push(`set final_review.corrective_budget_origin = ${budgetOrigin}`);

  const birth = buildCorrectiveBirth({
    correctiveTasks: node.corrective_tasks,
    maxRetries: config.limits.max_retries_per_task,
    budgetOrigin,
    scopeDocPath: null,
    scopeDocRequired: false,
    reviewReportPath: node.doc_path,
    injectedAfter: 'final_review',
    reason,
    template,
  });

  if (!birth.ok) {
    node.status = 'halted';
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason = birth.haltReason;
    mutations_applied.push('set final_review.status = halted (corrective budget exhausted)');
    mutations_applied.push('set graph.status = halted');
    mutations_applied.push('set pipeline.halt_reason (corrective budget exhausted)');
    return { state: cloned, mutations_applied };
  }

  const entry = birth.entry;
  entry.origin = 'operator';
  node.corrective_tasks.push(entry);
  mutations_applied.push(`injected final corrective task ${entry.index} (operator change request)`);
  mutations_applied.push(`set final_corrective_task[${entry.index}].review_report_path = ${entry.review_report_path ?? 'null'}`);

  // The host completed when its report landed; re-opening it is what puts the
  // new entry back in the walker's path instead of the approval gate.
  node.status = 'in_progress';
  mutations_applied.push('set final_review.status = in_progress');

  // Stand the gate down while the corrective runs, the way plan_rejected stands
  // plan_approval_gate down. Resetting status (not just gate_active) is what
  // lets the walker's not_started arm re-arm the gate once the corrective closes
  // and final_review completes again.
  const gateNode = resolveNodeState(cloned, 'final_approval_gate', 'top') as GateNodeState;
  gateNode.status = 'not_started';
  mutations_applied.push('set final_approval_gate.status = not_started');
  gateNode.gate_active = false;
  mutations_applied.push('set final_approval_gate.gate_active = false');

  cloned.pipeline.current_tier = 'review';
  mutations_applied.push('set pipeline.current_tier = review');

  return { state: cloned, mutations_applied };
});

// ── final_rejected mutation ───────────────────────────────────────────────────

mutationRegistry.set(EVENTS.FINAL_REJECTED, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  cloned.pipeline.current_tier = 'halted';
  mutations_applied.push('set pipeline.current_tier = halted');

  cloned.graph.status = 'halted';
  mutations_applied.push('set graph.status = halted');

  // Intentional: use || (not ??) so that an empty-string reason also falls back
  // to the default, matching gate_rejected.
  const reason = context.reason || 'No reason provided';
  cloned.pipeline.halt_reason = `Final review rejected by the operator: ${reason}`;
  mutations_applied.push(`set pipeline.halt_reason = Final review rejected by the operator: ${reason}`);

  // Marking the node halted is what makes the halted node identifiable — the
  // amendment path reads it to know this halt is recoverable.
  const finalReviewNode = resolveNodeState(cloned, 'final_review', 'top') as StepNodeState;
  finalReviewNode.status = 'halted';
  mutations_applied.push('set final_review.status = halted');

  return { state: cloned, mutations_applied };
});

// ── halt mutation ─────────────────────────────────────────────────────────────

mutationRegistry.set(EVENTS.HALT, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  cloned.pipeline.current_tier = 'halted';
  mutations_applied.push('set pipeline.current_tier = halted');

  cloned.graph.status = 'halted';
  mutations_applied.push('set graph.status = halted');

  const haltReason = context.reason ?? 'Pipeline halted by operator';
  cloned.pipeline.halt_reason = haltReason;
  mutations_applied.push(`set pipeline.halt_reason = ${haltReason}`);

  return { state: cloned, mutations_applied };
});

// ── gate_mode_set mutation ────────────────────────────────────────────────────

mutationRegistry.set(EVENTS.GATE_MODE_SET, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mode = context.gate_mode;

  if (!mode || !['task', 'phase', 'autonomous'].includes(mode as string)) {
    throw new Error(`Invalid gate mode '${mode}': expected task, phase, or autonomous`);
  }

  cloned.pipeline.gate_mode = mode as string;
  return {
    state: cloned,
    mutations_applied: [`set pipeline.gate_mode = ${mode}`],
  };
});

// ── Public API ────────────────────────────────────────────────────────────────

export function getMutation(event: string): MutationFn | undefined {
  return mutationRegistry.get(event);
}
