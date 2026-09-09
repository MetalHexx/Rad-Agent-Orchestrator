/**
 * The amendment frontier — the line between plan content that is still soft and
 * plan content that some agent has already acted on.
 *
 * It is read straight off `state.json`, per container: `phase_loop` has one
 * frontier, and each phase's `task_loop` has its own. A phase brief is frozen
 * once a review judged it or the run stopped on it; a task block is frozen once
 * a review judged it or a coder landed real work on it — not merely because the
 * DAG walker's cursor arrived. Frozen content may never be replaced, displaced,
 * or renumbered. Every freeze decision the merge checker makes comes from here,
 * so the rule is written once.
 */

import type { ParsedMasterPlan } from '../explode-master-plan.js';

// ── The state subtree this module reads ──────────────────────────────────────
// Structural shapes only. The pipeline engine owns `state.json`'s full types;
// reading a handful of statuses must not drag the runtime into this surface.

/** One task iteration inside a phase's `task_loop`. */
export interface TaskIteration {
  index: number;
  status: string;
  doc_path?: string | null;
  complexity?: string;
  repos?: { name: string; commit_hash: string | null }[];
  nodes?: Record<string, { status?: string } | undefined>;
}

/** A node inside a phase iteration — `task_loop`, plus the tier's review/gate nodes. */
export interface PhaseIterationNode {
  kind?: string;
  status?: string;
  iterations?: TaskIteration[];
}

/** One phase iteration inside `phase_loop`. */
export interface PhaseIteration {
  index: number;
  status: string;
  doc_path?: string | null;
  nodes?: Record<string, PhaseIterationNode | undefined>;
}

/** A top-level entry of `state.graph.nodes`. */
export interface GraphNode {
  kind?: string;
  status?: string;
  doc_path?: string | null;
  iterations?: PhaseIteration[];
}

export interface PipelineState {
  graph: { nodes: Record<string, GraphNode | undefined> };
  pipeline?: {
    gate_mode?: string;
    current_tier?: string;
    halt_reason?: string | null;
    source_control?: { repos?: { name?: string }[] };
  };
  /** The project's own identity and the amendments already applied. Only the
   *  index is read off a record here; `merge-state.ts` owns its full shape. */
  project?: { name?: string; amendments?: { index: number }[] };
}

/**
 * The one index the next amendment may legally declare: one past the highest
 * already applied, or 1 for a project that has never been amended. `status`
 * reports it as the index to author against and the merge checker enforces it,
 * so both must read it from here.
 */
export function nextAmendmentIndex(state: PipelineState): number {
  const applied = state.project?.amendments ?? [];
  return applied.reduce((max, entry) => Math.max(max, entry.index), 0) + 1;
}

// ── The frontier ─────────────────────────────────────────────────────────────

export interface Frontier {
  /** Phase index (1-based) → whether that phase's brief may be replaced. */
  phaseBriefEditable: Map<number, boolean>;
  /** "P{NN}-T{MM}" → whether that task's block may be replaced or displaced. */
  taskEditable: Map<string, boolean>;
  /** "P{NN}-T{MM}" → why that task is frozen, e.g. `completed` or
   *  `in progress with work committed to rad-orc-source`. Absent for an editable task. */
  taskFrozenReason: Map<string, string>;
  /** Phase index (1-based) → why that phase's brief is frozen. Absent for an editable phase. */
  phaseFrozenReason: Map<number, string>;
  /** First phase index at which insertion is legal, i.e. lowest editable phase. */
  firstEditablePhase: number | null;
  /** Non-null when a halt sits somewhere other than the final review step. */
  upstreamHalt: { node: string; reason: string } | null;
}

/**
 * A phase brief is soft while the phase has not run or is still running.
 * `completed`, `skipped`, `halted`, and `failed` all freeze it — a phase review
 * has judged its exit criteria, or the run stopped in a way that must be
 * cleared rather than rewritten.
 */
const PHASE_BRIEF_EDITABLE_STATUSES = new Set(['not_started', 'in_progress']);

/**
 * A task is soft before it starts, and stays soft while it runs with nothing
 * landed. The DAG walker flips a task iteration — and its nested `task_executor`
 * step — to `in_progress` the moment its cursor arrives, before any coder is
 * spawned, so neither status can tell "just activated" from "a coder is working
 * here". A repo's `commit_hash` is written only inside that task's own
 * `task_completed` mutation, for a repo the coder reported committed, so a
 * non-null hash is the evidence of engagement and its absence is proof none has
 * landed. `completed`, `skipped`, `halted`, and `failed` freeze unconditionally.
 */
const TASK_UNSTARTED_STATUS = 'not_started';
const TASK_RUNNING_STATUS = 'in_progress';

const HALTED = 'halted';

const DEFAULT_HALT_REASON = 'no halt reason recorded';

/** The plan's phase anchor form, e.g. `P04`. */
export function phaseId(phaseIndex: number): string {
  return `P${String(phaseIndex).padStart(2, '0')}`;
}

/** The plan's task anchor form, e.g. `P04-T02`. */
export function taskId(phaseIndex: number, taskIndex: number): string {
  return `${phaseId(phaseIndex)}-T${String(taskIndex).padStart(2, '0')}`;
}

/** Whether a task block may still be replaced or displaced by an amendment. */
function isTaskEditable(taskIteration: TaskIteration): boolean {
  if (taskIteration.status === TASK_UNSTARTED_STATUS) return true;
  if (taskIteration.status !== TASK_RUNNING_STATUS) return false;
  return !(taskIteration.repos ?? []).some(
    (repo) => typeof repo.commit_hash === 'string' && repo.commit_hash !== '',
  );
}

/**
 * Why a task is frozen, reading the same two facts `isTaskEditable` reads.
 * Returns `undefined` for an editable task — a repo entry with a null or empty
 * hash never freezes a running task, so it is never named as a reason.
 */
function taskFrozenReasonFor(taskIteration: TaskIteration): string | undefined {
  if (taskIteration.status === TASK_UNSTARTED_STATUS) return undefined;
  if (taskIteration.status !== TASK_RUNNING_STATUS) return taskIteration.status;
  const committedRepos = (taskIteration.repos ?? [])
    .filter((repo) => typeof repo.commit_hash === 'string' && repo.commit_hash !== '')
    .map((repo) => repo.name);
  if (committedRepos.length === 0) return undefined;
  return `in progress with work committed to ${committedRepos.join(', ')}`;
}

/** Why a phase brief is frozen — its own iteration status. `undefined` when editable. */
function phaseFrozenReasonFor(status: string): string | undefined {
  return PHASE_BRIEF_EDITABLE_STATUSES.has(status) ? undefined : status;
}

/**
 * Compute the frontier for a project's current pipeline state.
 *
 * `taskEditable` and `taskFrozenReason` are keyed by the id the plan itself
 * gives the task at that position, because every consumer looks them up with a
 * plan id. Synthesizing the key from the iteration's position instead would only
 * agree with the plan while its task numbering restarts at T01 in every phase —
 * against a plan numbered continuously across phases every lookup would miss,
 * and a missing entry reads as frozen. The positional form remains the fallback
 * for a state carrying an iteration the plan no longer holds.
 *
 * Iteration `index` fields are 0-based in `state.json` while plan indices are
 * 1-based, so every phase index built here shifts by one.
 *
 * A halt on the top-level `final_review` step is deliberately NOT an upstream
 * halt: that is the recoverable case an amendment exists to clear, so only
 * halts inside `phase_loop` block one.
 */
export function computeFrontier(state: PipelineState, plan: ParsedMasterPlan): Frontier {
  const phaseBriefEditable = new Map<number, boolean>();
  const taskEditable = new Map<string, boolean>();
  const taskFrozenReason = new Map<string, string>();
  const phaseFrozenReason = new Map<number, string>();
  let firstEditablePhase: number | null = null;
  let upstreamHalt: { node: string; reason: string } | null = null;

  const haltReason = state.pipeline?.halt_reason ?? DEFAULT_HALT_REASON;
  // First halt found wins — the earliest one is the one an operator must clear.
  const noteHalt = (node: string): void => {
    if (upstreamHalt === null) upstreamHalt = { node, reason: haltReason };
  };

  const phaseIterations = state.graph?.nodes?.['phase_loop']?.iterations ?? [];

  for (const phaseIteration of phaseIterations) {
    const phaseIndex = phaseIteration.index + 1;
    const phasePath = `phase_loop[${phaseIteration.index}]`;

    const briefEditable = PHASE_BRIEF_EDITABLE_STATUSES.has(phaseIteration.status);
    phaseBriefEditable.set(phaseIndex, briefEditable);
    const briefReason = phaseFrozenReasonFor(phaseIteration.status);
    if (briefReason !== undefined) phaseFrozenReason.set(phaseIndex, briefReason);
    if (briefEditable && (firstEditablePhase === null || phaseIndex < firstEditablePhase)) {
      firstEditablePhase = phaseIndex;
    }
    if (phaseIteration.status === HALTED) noteHalt(phasePath);

    for (const [nodeId, node] of Object.entries(phaseIteration.nodes ?? {})) {
      if (node === undefined) continue;
      if (node.status === HALTED) noteHalt(`${phasePath}.${nodeId}`);

      for (const taskIteration of node.iterations ?? []) {
        const taskPath = `${phasePath}.${nodeId}[${taskIteration.index}]`;
        const id = plan.phases[phaseIndex - 1]?.tasks[taskIteration.index]?.id
          ?? taskId(phaseIndex, taskIteration.index + 1);
        taskEditable.set(id, isTaskEditable(taskIteration));
        const taskReason = taskFrozenReasonFor(taskIteration);
        if (taskReason !== undefined) taskFrozenReason.set(id, taskReason);
        if (taskIteration.status === HALTED) noteHalt(taskPath);

        for (const [innerId, innerNode] of Object.entries(taskIteration.nodes ?? {})) {
          if (innerNode?.status === HALTED) noteHalt(`${taskPath}.${innerId}`);
        }
      }
    }
  }

  return { phaseBriefEditable, taskEditable, taskFrozenReason, phaseFrozenReason, firstEditablePhase, upstreamHalt };
}
