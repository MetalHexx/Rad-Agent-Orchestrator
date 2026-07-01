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
  NodeDef,
  StepNodeDef,
  ForEachPhaseNodeState,
  ForEachPhaseNodeDef,
  ForEachTaskNodeDef,
  ParseErrorDetail,
  PipelineTemplate,
} from './types.js';
import { EVENTS, VALID_VERDICTS, REVIEW_VERDICTS } from './constants.js';
import { scaffoldNodeState } from './scaffold.js';
import { resolveActivePhaseIndex, resolveActiveTaskIndex } from './context-enrichment.js';

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

type ResolveScope = 'top' | 'phase' | 'task';

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
  // Iter 11 — phase-level corrective tasks (from phase_review_completed with an
  // orchestrator-supplied handoff path) now carry pre-seeded task-body nodes
  // (scaffolded via findTaskLoopBodyDefs + a synthesized completed task_handoff
  // sub-node). Under the iter-11 invariant this check DOES hit for an active
  // phase-scope corrective — mutations targeting `task`-scope nodes during a
  // phase-scope corrective's body walk resolve to that corrective's `nodes`
  // map. Task-level corrective tasks (from code_review_completed) likewise
  // populate nodes. Legacy empty-nodes entries from pre-iter-11 state snapshots
  // (not expected in new runs) still fall through cleanly because `nodeId in
  // latest.nodes` returns false.
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

  // Iter 11 — orchestrator mediation contract (parallels iter-10 code_review).
  // `effective_outcome` (supplied by the orchestrator's addendum on
  // `changes_requested` phase reviews) is the routing-authoritative verdict
  // when present; it overrides the reviewer's raw verdict for state-write
  // purposes. Approved/rejected verdicts pass through unmediated
  // (effective_outcome absent). See the iter-11 plan for the full contract.
  const effectiveOutcome = (context as Record<string, unknown>).effective_outcome as string | undefined;
  const correctiveHandoffPath = (context as Record<string, unknown>).corrective_handoff_path as string | undefined;
  const orchestratorMediated = (context as Record<string, unknown>).orchestrator_mediated;
  // Gate effective_outcome usage to the full frontmatter mediation contract:
  // raw verdict must be changes_requested AND orchestrator_mediated must be
  // true AND effective_outcome must be present. Validator enforces the same
  // contract (orchestrator_mediated required when verdict=changes_requested,
  // mustBeAbsent otherwise), but this gate is a defense-in-depth guard — if
  // validation is bypassed (test harness, malformed CLI context, future
  // refactor), a raw approved review cannot be silently overwritten to
  // changes_requested by a stray effective_outcome field, and a missing
  // orchestrator_mediated flag cannot route via the mediation path.
  const mediationActive = rawVerdict === REVIEW_VERDICTS.CHANGES_REQUESTED
    && orchestratorMediated === true
    && effectiveOutcome !== undefined
    && effectiveOutcome !== null;
  const verdictForState = mediationActive ? effectiveOutcome : rawVerdict;

  (node as StepNodeState).verdict = verdictForState;
  mutations_applied.push(`set phase_review.verdict = ${verdictForState ?? 'null'}`);

  // Unknown-verdict halt — evaluates against the raw verdict, since that is
  // what the reviewer produced and what the halt_reason message is keyed to.
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

  // Routing-authoritative verdict for the corrective birth / halt decision.
  const routingVerdict = verdictForState;

  if (routingVerdict === REVIEW_VERDICTS.CHANGES_REQUESTED) {
    const iteration = resolvePhaseIteration(cloned, phase);
    const correctiveCount = iteration.corrective_tasks.length;
    const maxRetries = config.limits.max_retries_per_task;
    // Normalize the handoff path via trim so a value like " tasks/foo.md " is
    // stored without the stray whitespace. The non-empty-after-trim check
    // still gates the halt branch; the trimmed value is what lands in state.
    const trimmedHandoffPath = typeof correctiveHandoffPath === 'string'
      ? correctiveHandoffPath.trim()
      : '';
    const hasHandoffPath = trimmedHandoffPath.length > 0;

    // No handoff path supplied — this is the orchestrator's budget-exhausted
    // halt signal per the corrective-playbook budget-check contract. Produce a
    // clean halt with a descriptive halt_reason. Note: an orchestrator that
    // forgot to supply a handoff when budget was available would also land
    // here, which is acceptable — the halt message names both possibilities
    // so the operator can investigate. The fail-loud beats silent corruption.
    if (!hasHandoffPath) {
      iteration.status = 'halted';
      cloned.graph.status = 'halted';
      cloned.pipeline.halt_reason =
        `phase_review_completed: effective_outcome=changes_requested with no corrective_handoff_path. ` +
        `Possible causes: (1) budget exhausted ` +
        `(phase corrective_tasks.length=${correctiveCount}, max_retries_per_task=${maxRetries}) — ` +
        `this is the expected halt per the corrective-playbook; ` +
        `(2) orchestrator omitted the handoff path in error — check the review addendum.`;
      mutations_applied.push('set phase_iteration.status = halted (effective_outcome=changes_requested, no handoff)');
      mutations_applied.push('set graph.status = halted');
      mutations_applied.push('set pipeline.halt_reason (budget-exhausted halt signal)');
      return { state: cloned, mutations_applied };
    }

    if (correctiveCount >= maxRetries) {
      // Budget exhausted but a handoff path was supplied — the orchestrator's
      // soft contract says "do not author a handoff on exhaustion", so this is
      // a contract violation (either a rogue orchestrator or a stale state).
      // Hard-error via a halt so the operator sees it, per the plan's
      // mutation-side backstop requirement.
      iteration.status = 'halted';
      cloned.graph.status = 'halted';
      cloned.pipeline.halt_reason =
        `Retry budget exhausted for phase (max_retries_per_task=${maxRetries}) but a ` +
        `corrective_handoff_path was supplied. The orchestrator must not author a ` +
        `corrective handoff on exhaustion — this is a contract violation.`;
      mutations_applied.push('set phase_iteration.status = halted (retry budget exhausted; handoff path supplied)');
      mutations_applied.push('set graph.status = halted');
      mutations_applied.push('set pipeline.halt_reason (budget exhausted with supplied handoff path)');
      return { state: cloned, mutations_applied };
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
      reason: context.reason ?? 'Phase review requested changes',
      injected_after: 'phase_review',
      status: 'not_started',
      nodes,
      doc_path: trimmedHandoffPath,
      repos: [],
    };
    iteration.corrective_tasks.push(entry);
    mutations_applied.push(`injected phase corrective task ${entry.index} (changes_requested)`);
    mutations_applied.push(`set phase_corrective_task[${entry.index}].doc_path = ${trimmedHandoffPath}`);
    mutations_applied.push(`phase corrective_tasks.length = ${iteration.corrective_tasks.length}`);
  } else if (routingVerdict === REVIEW_VERDICTS.REJECTED) {
    const iteration = resolvePhaseIteration(cloned, phase);
    iteration.status = 'halted';
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason =
      `Phase review rejected: reviewer issued a 'rejected' verdict. ` +
      `Rejected verdicts halt the pipeline with no corrective cycle — no retry is attempted.`;
    mutations_applied.push('set phase_iteration.status = halted (rejected verdict)');
    mutations_applied.push('set graph.status = halted');
    mutations_applied.push('set pipeline.halt_reason (reviewer rejected verdict)');
  } else if (
    rawVerdict === REVIEW_VERDICTS.CHANGES_REQUESTED &&
    routingVerdict !== REVIEW_VERDICTS.CHANGES_REQUESTED &&
    routingVerdict !== REVIEW_VERDICTS.APPROVED
  ) {
    // Defensive: raw changes_requested with no / bogus effective_outcome.
    // The validator should have rejected this; if we hit it, the contract
    // was bypassed.
    throw new Error(
      'phase_review_completed: raw verdict=changes_requested without a valid effective_outcome. ' +
      'The orchestrator mediation contract was bypassed — ensure the review doc carries ' +
      'orchestrator_mediated=true and effective_outcome ∈ {approved, changes_requested}.'
    );
  }
  // effective_outcome === 'approved' (with raw verdict=changes_requested) and
  // raw verdict=approved both fall through here with no corrective birth —
  // the mediation filter-down / raw approved paths are symmetric at the
  // state-mutation level.

  return { state: cloned, mutations_applied };
});

// ── task_completed ───────────────────────────────────────────────────────

mutationRegistry.set(EVENTS.TASK_COMPLETED, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

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

function findTaskLoopBodyDefs(template: PipelineTemplate): NodeDef[] {
  for (const nodeDef of template.nodes) {
    if (nodeDef.kind === 'for_each_phase') {
      for (const bodyNode of (nodeDef as ForEachPhaseNodeDef).body) {
        if (bodyNode.kind === 'for_each_task') {
          return (bodyNode as ForEachTaskNodeDef).body;
        }
      }
    }
  }
  return [];
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

  // Iter 10 — orchestrator mediation contract. `effective_outcome` (supplied by
  // the orchestrator's addendum on `changes_requested` reviews) is the
  // routing-authoritative verdict when present; it overrides the reviewer's
  // raw verdict for state-write purposes. Approved/rejected verdicts pass
  // through unmediated (effective_outcome absent). See the iter-10 plan for
  // the full contract.
  const effectiveOutcome = (context as Record<string, unknown>).effective_outcome as string | undefined;
  const correctiveHandoffPath = (context as Record<string, unknown>).corrective_handoff_path as string | undefined;
  const orchestratorMediated = (context as Record<string, unknown>).orchestrator_mediated;
  // Gate effective_outcome usage to the full frontmatter mediation contract:
  // raw verdict must be changes_requested AND orchestrator_mediated must be
  // true AND effective_outcome must be present. Validator enforces the same
  // contract (orchestrator_mediated required when verdict=changes_requested,
  // mustBeAbsent otherwise), but this gate is a defense-in-depth guard — if
  // validation is bypassed (test harness, malformed CLI context, future
  // refactor), a raw approved review cannot be silently overwritten to
  // changes_requested by a stray effective_outcome field, and a missing
  // orchestrator_mediated flag cannot route via the mediation path.
  const mediationActive = rawVerdict === REVIEW_VERDICTS.CHANGES_REQUESTED
    && orchestratorMediated === true
    && effectiveOutcome !== undefined
    && effectiveOutcome !== null;
  const verdictForState = mediationActive ? effectiveOutcome : rawVerdict;

  (node as StepNodeState).verdict = verdictForState;
  mutations_applied.push(`set code_review.verdict = ${verdictForState ?? 'null'}`);

  // Unknown-verdict halt — evaluates against the raw verdict, since that is
  // what the reviewer produced and what the halt_reason message is keyed to.
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

  // Routing-authoritative verdict for the corrective birth / halt decision.
  const routingVerdict = verdictForState;

  if (routingVerdict === REVIEW_VERDICTS.CHANGES_REQUESTED) {
    // Iter 11 — ancestor-derivation. When the completed code_review lives under
    // an active phase-scope corrective, the new corrective appends to
    // phaseIter.corrective_tasks; otherwise it appends to taskIter. Preserves
    // iter-10 task-scope behaviour identically when scope === 'task'.
    const { iteration, scope } = resolveHostingIteration(cloned, phase, task);

    // Corrective-of-a-corrective: when the code_review that just completed lives
    // on the hosting iteration's most recent corrective entry, that parent
    // corrective is now superseded — its review concluded (changes_requested)
    // and a successor corrective takes over. Finalize the parent here, BEFORE
    // pushing the child (after the push, length-1 is the child, not the parent).
    // The walker only ever finalizes the LATEST corrective, so without this the
    // parent is stranded at in_progress inside a later-completed iteration (the
    // HICCUP-TEST symptom). Uses the hosting iteration, so it covers both
    // task-scope and phase-scope correctives uniformly. An empty array (the
    // first corrective, born from an original task's code_review) is a no-op.
    // phase_review_completed needs no equivalent guard: phase_review is
    // single-pass and never fires on a corrective, so it has no parent
    // corrective to finalize.
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

    const correctiveCount = iteration.corrective_tasks.length;
    const maxRetries = config.limits.max_retries_per_task;
    // Normalize the handoff path via trim so a value like " tasks/foo.md " is
    // stored without the stray whitespace. The non-empty-after-trim check
    // still gates the halt branch; the trimmed value is what lands in state.
    const trimmedHandoffPath = typeof correctiveHandoffPath === 'string'
      ? correctiveHandoffPath.trim()
      : '';
    const hasHandoffPath = trimmedHandoffPath.length > 0;

    // No handoff path supplied — this is the orchestrator's budget-exhausted
    // halt signal per the corrective-playbook budget-check contract. Produce a
    // clean halt with a descriptive halt_reason. Note: an orchestrator that
    // forgot to supply a handoff when budget was available would also land
    // here, which is acceptable — the halt message names both possibilities
    // so the operator can investigate. The fail-loud beats silent corruption.
    if (!hasHandoffPath) {
      iteration.status = 'halted';
      cloned.graph.status = 'halted';
      cloned.pipeline.halt_reason =
        `code_review_completed: effective_outcome=changes_requested with no corrective_handoff_path. ` +
        `Possible causes: (1) budget exhausted ` +
        `(corrective_tasks.length=${correctiveCount}, max_retries_per_task=${maxRetries}, scope=${scope}) — ` +
        `this is the expected halt per the corrective-playbook; ` +
        `(2) orchestrator omitted the handoff path in error — check the review addendum.`;
      mutations_applied.push(`set ${scope}_iteration.status = halted (effective_outcome=changes_requested, no handoff, scope=${scope})`);
      mutations_applied.push('set graph.status = halted');
      mutations_applied.push('set pipeline.halt_reason (budget-exhausted halt signal)');
      return { state: cloned, mutations_applied };
    }

    if (correctiveCount >= maxRetries) {
      // Budget exhausted but a handoff path was supplied — the orchestrator's
      // soft contract says "do not author a handoff on exhaustion", so this is
      // a contract violation (either a rogue orchestrator or a stale state).
      // Hard-error via a halt so the operator sees it, per the plan's
      // mutation-side backstop requirement.
      iteration.status = 'halted';
      cloned.graph.status = 'halted';
      cloned.pipeline.halt_reason =
        `Retry budget exhausted for ${scope} (max_retries_per_task=${maxRetries}) but a ` +
        `corrective_handoff_path was supplied. The orchestrator must not author a ` +
        `corrective handoff on exhaustion — this is a contract violation.`;
      mutations_applied.push(`set ${scope}_iteration.status = halted (retry budget exhausted; handoff path supplied, scope=${scope})`);
      mutations_applied.push('set graph.status = halted');
      mutations_applied.push('set pipeline.halt_reason (budget exhausted with supplied handoff path)');
      return { state: cloned, mutations_applied };
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
      reason: context.reason ?? 'Code review requested changes',
      injected_after: 'code_review',
      status: 'not_started',
      nodes,
      doc_path: trimmedHandoffPath,
      repos: [],
    };
    iteration.corrective_tasks.push(entry);
    mutations_applied.push(`injected corrective task ${entry.index} (changes_requested, scope=${scope})`);
    mutations_applied.push(`set corrective_task[${entry.index}].doc_path = ${trimmedHandoffPath}`);
    mutations_applied.push(`corrective_tasks.length = ${iteration.corrective_tasks.length} (scope=${scope})`);
  } else if (routingVerdict === REVIEW_VERDICTS.REJECTED) {
    // Iter 11 — the rejected verdict must halt the hosting iteration, not the
    // task iteration unconditionally. When a phase-scope corrective's code
    // review returns `rejected`, we halt the phase iteration (its ancestor)
    // rather than a stale-default task iteration. Uses the same
    // ancestor-derivation helper that the `changes_requested` branch uses.
    const { iteration, scope } = resolveHostingIteration(cloned, phase, task);
    iteration.status = 'halted';
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason =
      `Code review rejected (scope=${scope}): reviewer issued a 'rejected' verdict. ` +
      `Rejected verdicts halt the pipeline with no corrective cycle — no retry is attempted.`;
    mutations_applied.push(`set ${scope === 'phase' ? 'phase_iteration' : 'task_iteration'}.status = halted (rejected verdict, scope=${scope})`);
    mutations_applied.push('set graph.status = halted');
    mutations_applied.push('set pipeline.halt_reason (reviewer rejected verdict)');
  } else if (
    rawVerdict === REVIEW_VERDICTS.CHANGES_REQUESTED &&
    routingVerdict !== REVIEW_VERDICTS.CHANGES_REQUESTED &&
    routingVerdict !== REVIEW_VERDICTS.APPROVED
  ) {
    // Defensive: raw changes_requested with no / bogus effective_outcome.
    // The validator should have rejected this; if we hit it, the contract
    // was bypassed.
    throw new Error(
      'code_review_completed: raw verdict=changes_requested without a valid effective_outcome. ' +
      'The orchestrator mediation contract was bypassed — ensure the review doc carries ' +
      'orchestrator_mediated=true and effective_outcome ∈ {approved, changes_requested}.'
    );
  }
  // effective_outcome === 'approved' (with raw verdict=changes_requested) and
  // raw verdict=approved both fall through here with no corrective birth —
  // the mediation filter-down / raw approved paths are symmetric at the
  // state-mutation level.

  return { state: cloned, mutations_applied };
});

// ── Final review mutations ────────────────────────────────────────────────────

mutationRegistry.set(EVENTS.FINAL_REVIEW_COMPLETED, (state, context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  const node = resolveNodeState(cloned, 'final_review', 'top');
  node.status = 'completed';
  mutations_applied.push('set final_review.status = completed');

  const docPath = context.doc_path ?? null;
  (node as StepNodeState).doc_path = docPath;
  mutations_applied.push(`set final_review.doc_path = ${docPath ?? 'null'}`);

  const verdict = context.verdict ?? null;
  (node as StepNodeState).verdict = verdict;
  mutations_applied.push(`set final_review.verdict = ${verdict ?? 'null'}`);

  if (verdict !== null && !VALID_VERDICTS.has(verdict as string)) {
    cloned.graph.status = 'halted';
    cloned.pipeline.halt_reason = `Unrecognized verdict '${verdict}' in final_review_completed`;
    return {
      state: cloned,
      mutations_applied: [
        ...mutations_applied,
        `set graph.status = halted (unrecognized verdict '${verdict}')`,
      ],
    };
  }

  if (verdict === REVIEW_VERDICTS.APPROVED) {
    cloned.pipeline.current_tier = 'review';
    mutations_applied.push('set pipeline.current_tier = review');
  }

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

// ── final_rejected mutation ───────────────────────────────────────────────────

mutationRegistry.set(EVENTS.FINAL_REJECTED, (state, _context, _config, _template): MutationResult => {
  const cloned = structuredClone(state);
  const mutations_applied: string[] = [];

  const finalReviewNode = resolveNodeState(cloned, 'final_review', 'top');
  finalReviewNode.status = 'not_started';
  mutations_applied.push('set final_review.status = not_started');
  (finalReviewNode as StepNodeState).doc_path = null;
  mutations_applied.push('set final_review.doc_path = null');

  const finalGateNode = resolveNodeState(cloned, 'final_approval_gate', 'top');
  finalGateNode.status = 'not_started';
  mutations_applied.push('set final_approval_gate.status = not_started');
  (finalGateNode as GateNodeState).gate_active = false;
  mutations_applied.push('set final_approval_gate.gate_active = false');

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
