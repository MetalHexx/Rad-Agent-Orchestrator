/**
 * The amendment state writer — the state half of the transaction.
 *
 * It places the merged plan's phases and tasks into `state.json`'s iteration
 * arrays, stamps the amendment's index on everything it introduced, resets the
 * work the amendment invalidated, and records the amendment itself.
 *
 * Two properties hold it up. First, an iteration that already ran is carried
 * across by reference: it is moved into its merged slot and its `index` is
 * rewritten, and nothing else about it is touched, so a completed task's
 * execution history survives the amendment byte for byte. Second, the reopen
 * cascade is walked, never assumed — `mergePlan.reopens` was presence-filtered
 * against this project's own state when it was computed, so a tier that declares
 * no phase review resets only the nodes it actually carries.
 *
 * Nothing here decides anything: the numbering, the reopen cascade and the halt
 * to clear all arrive pre-computed on `AmendmentMergePlan`.
 */

import * as path from 'node:path';
import {
  buildPhaseIterationEntry,
  buildTaskIterationEntry,
  phaseFilename,
  taskFilename,
  toRelativeDocPath,
} from '../plan-emitters.js';
import type { IterationEntry } from '../plan-emitters.js';
import type { ParsedMasterPlan, ParsedPhase, ParsedTask } from '../explode-master-plan.js';
import { phaseId, taskId } from './frontier.js';
import type { PipelineState } from './frontier.js';
import type { AmendmentMergePlan } from './merge-check.js';

// ── The state subtree this module writes ─────────────────────────────────────
// A widened view of `frontier.ts`'s read-only shapes. The pipeline engine owns
// `state.json`'s full types; an amendment writes a handful of regions and carries
// every other key through untouched, so it describes only what it touches.

/** A node of `state.graph.nodes`, or of an iteration's own `nodes` map. */
export interface AmendableNode {
  kind?: string;
  status?: string;
  doc_path?: string | null;
  gate_active?: boolean;
  verdict?: string | null;
  corrective_tasks?: unknown[];
  corrective_budget_origin?: number;
  iterations?: AmendableIteration[];
}

/** One phase or task iteration. `amendment` is set only on iterations an amendment introduced. */
export interface AmendableIteration extends Omit<IterationEntry, 'nodes'> {
  nodes: Record<string, AmendableNode>;
  amendment?: number;
}

/** One entry of `state.project.amendments`. */
export interface AmendmentRecord {
  index: number;
  doc_path: string;
  applied: string;
  adds_phases: string[];
  adds_tasks: string[];
  revises_tasks: string[];
  drops_tasks: string[];
  drops_phases: string[];
}

interface ProjectSection {
  name?: string;
  updated?: string;
  amendments?: AmendmentRecord[];
  [key: string]: unknown;
}

export interface AmendableState extends PipelineState {
  project?: ProjectSection;
  graph: {
    status?: string;
    current_node_path?: string | null;
    nodes: Record<string, AmendableNode>;
  };
}

export interface StateMergeInput {
  /** The project's parsed `state.json`. Cloned, never mutated. */
  state: AmendableState;
  /** The plan as it stands BEFORE this merge — the source of the real id each existing
   *  iteration is keyed by, which the numbering map is keyed by too. */
  existing: ParsedMasterPlan;
  /** The merged plan as the rebuilt Master Plan states it — the numbering both halves share. */
  merged: ParsedMasterPlan;
  mergePlan: AmendmentMergePlan;
  projectDir: string;
  projectName: string;
  /** Project-relative path of the amendment document, for the record. */
  amendmentDocPath: string;
  nowIso: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const NOT_STARTED = 'not_started';
const IN_PROGRESS = 'in_progress';
const COMPLETED = 'completed';

const PHASE_LOOP = 'phase_loop';
const TASK_LOOP = 'task_loop';
const FINAL_REVIEW = 'final_review';

const EXECUTION_TIER = 'execution';

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Merge an amendment into a project's pipeline state.
 *
 * Returns a new state object; the input is left alone so the caller can stage the
 * write and still hold the pre-apply state to roll back to.
 */
export function mergeAmendmentIntoState(input: StateMergeInput): AmendableState {
  const state = structuredClone(input.state);

  const phaseLoop = state.graph?.nodes?.[PHASE_LOOP];
  if (phaseLoop === undefined) {
    throw internalError(`state.json carries no ${PHASE_LOOP} node — there is no plan to amend`);
  }

  const slots = new SlotIndex(input.merged);
  const amendedPhases = rebuildPhaseIterations(input, phaseLoop, slots);

  reopenDownstream(state, input.existing, input.mergePlan, phaseLoop, amendedPhases);
  if (input.mergePlan.clearsHalt !== null) clearFinalScopeHalt(state);
  recordAmendment(state, input);

  return state;
}

// ── Iteration placement ──────────────────────────────────────────────────────

/**
 * Where every phase and task of the merged plan sits, keyed by its merged id. The
 * merged plan is the one source of truth for position, so no id is ever parsed
 * back into a number.
 */
class SlotIndex {
  private readonly phases = new Map<string, number>();
  private readonly tasks = new Map<string, { phase: number; task: number }>();

  constructor(private readonly merged: ParsedMasterPlan) {
    merged.phases.forEach((phase, phaseSlot) => {
      this.phases.set(phase.id, phaseSlot);
      phase.tasks.forEach((task, taskSlot) => {
        this.tasks.set(task.id, { phase: phaseSlot, task: taskSlot });
      });
    });
  }

  phaseSlot(id: string): number {
    const slot = this.phases.get(id);
    if (slot === undefined) throw internalError(`the merged plan holds no phase ${id}`);
    return slot;
  }

  taskSlot(id: string): { phase: number; task: number } {
    const slot = this.tasks.get(id);
    if (slot === undefined) throw internalError(`the merged plan holds no task ${id}`);
    return slot;
  }

  phase(slot: number): ParsedPhase {
    const phase = this.merged.phases[slot];
    if (phase === undefined) throw internalError(`the merged plan holds no phase at slot ${slot + 1}`);
    return phase;
  }

  task(phaseSlot: number, taskSlot: number): ParsedTask {
    const task = this.phase(phaseSlot).tasks[taskSlot];
    if (task === undefined) {
      throw internalError(`the merged plan holds no task at slot ${taskId(phaseSlot + 1, taskSlot + 1)}`);
    }
    return task;
  }

  get phaseCount(): number {
    return this.merged.phases.length;
  }
}

/**
 * Rewrite `phase_loop.iterations` into merged order: every existing iteration
 * moved to the slot the merge plan assigns it, a dropped phase left unplaced,
 * every amendment-born phase built fresh.
 *
 * Returns the merged slots of the existing phases whose own task set changed —
 * gained a task, lost one, or had one revised — the only running work the
 * amendment displaces, and so the only phase iterations whose own review and gate
 * are reopened.
 */
function rebuildPhaseIterations(
  input: StateMergeInput,
  phaseLoop: AmendableNode,
  slots: SlotIndex,
): Set<number> {
  const existing = phaseLoop.iterations ?? [];
  const placed: (AmendableIteration | undefined)[] = new Array(slots.phaseCount);
  const amended = new Set<number>();
  const dropsPhaseIds = new Set(input.mergePlan.dropsPhases);

  existing.forEach((iteration, i) => {
    const sourceId = phaseId(i + 1);
    const finalId = input.mergePlan.numbering.phases.get(sourceId);
    if (finalId === undefined) {
      // Absent from the numbering and not a declared drop is a bug; absent
      // because it IS a declared drop is the expected shape of a removal — the
      // iteration is simply not placed, and `placed`'s merged-sized array ends up
      // one occupant short.
      if (!dropsPhaseIds.has(sourceId)) {
        throw internalError(`the merge plan's numbering carries no entry for phase ${sourceId}`);
      }
      return;
    }
    const slot = slots.phaseSlot(finalId);
    if (rebuildTaskIterations(input, iteration, i + 1, slot, slots)) amended.add(slot);
    iteration.index = slot;
    place(placed, slot, `phase iteration ${finalId}`, iteration);
  });

  for (const added of input.mergePlan.addsPhases) {
    const slot = slots.phaseSlot(added.id);
    place(placed, slot, `phase iteration ${added.id}`, introducedPhaseIteration(input, slots.phase(slot), slot));
  }

  phaseLoop.iterations = placed.map((iteration, i) => {
    if (iteration === undefined) {
      throw internalError(`no iteration landed at merged phase ${phaseId(i + 1)}`);
    }
    return iteration;
  });

  return amended;
}

/**
 * The same placement, one level down: an existing phase's task iterations moved to
 * their merged slots, a revised one reset in place, a dropped one left unplaced,
 * and the amendment's new tasks spliced in beside them.
 *
 * Returns whether this phase's task set changed in a way that reopens its own
 * review: gained a task, lost one, or had one revised.
 */
function rebuildTaskIterations(
  input: StateMergeInput,
  phaseIteration: AmendableIteration,
  sourcePhaseIndex: number,
  phaseSlot: number,
  slots: SlotIndex,
): boolean {
  const added = input.mergePlan.addsTasks.filter(task => slots.taskSlot(task.id).phase === phaseSlot);
  const taskLoop = phaseIteration.nodes?.[TASK_LOOP];
  if (taskLoop === undefined) {
    if (added.length === 0) return false;
    throw internalError(
      `phase iteration ${phaseId(sourcePhaseIndex)} carries no ${TASK_LOOP} node, so it cannot gain a task`,
    );
  }

  const existing = taskLoop.iterations ?? [];
  const dropsTaskIds = new Set(input.mergePlan.dropsTasks);
  const revisedTaskIds = new Set(input.mergePlan.revisesTasks.map(task => task.id));
  const placed: (AmendableIteration | undefined)[] = new Array(slots.phase(phaseSlot).tasks.length);
  let changed = added.length > 0;

  existing.forEach((iteration, j) => {
    // The numbering map is keyed by the id the pre-merge plan gives each task, so
    // the key is read off that plan at this position rather than synthesized from
    // it — the two only agree while the plan restarts its task numbering in every
    // phase. `doc_path` is not an alternative: a carried task's handoff is never
    // re-emitted, so it still names the id the task had at first explosion.
    const sourceId = input.existing.phases[sourcePhaseIndex - 1]?.tasks[j]?.id
      ?? taskId(sourcePhaseIndex, j + 1);
    const finalId = input.mergePlan.numbering.tasks.get(sourceId);
    if (finalId === undefined) {
      // Absent from the numbering and not a declared drop is a bug; absent
      // because it IS a declared drop is the expected shape of a removal — the
      // iteration is simply not placed, and `placed`'s merged-sized array ends up
      // one occupant short.
      if (!dropsTaskIds.has(sourceId)) {
        throw internalError(`the merge plan's numbering carries no entry for task ${sourceId}`);
      }
      changed = true;
      return;
    }
    const slot = slots.taskSlot(finalId);
    if (slot.phase !== phaseSlot) {
      throw internalError(
        `the merge plan sends task ${sourceId} to ${finalId}, outside its phase's merged slot ${phaseId(phaseSlot + 1)}`,
      );
    }
    iteration.index = slot.task;
    if (revisedTaskIds.has(finalId)) {
      resetRevisedIteration(iteration);
      changed = true;
    }
    place(placed, slot.task, `task iteration ${finalId}`, iteration);
  });

  for (const entry of added) {
    const slot = slots.taskSlot(entry.id);
    place(placed, slot.task, `task iteration ${entry.id}`,
      introducedTaskIteration(input, slots.task(phaseSlot, slot.task), slot.task));
  }

  taskLoop.iterations = placed.map((iteration, j) => {
    if (iteration === undefined) {
      throw internalError(`no iteration landed at merged task ${taskId(phaseSlot + 1, j + 1)}`);
    }
    return iteration;
  });

  return changed;
}

/**
 * A revised task's iteration keeps its identity — `doc_path` (the handoff the
 * revision just rewrote), its own `amendment` key (the origin marker, not the
 * reviser's), and its `repos[].commit_hash` (already null; the frontier refuses
 * to revise a task that has landed one) — but the work itself is unrun: its
 * status and every nested node's status go back to `not_started`.
 */
function resetRevisedIteration(iteration: AmendableIteration): void {
  iteration.status = NOT_STARTED;
  for (const node of Object.values(iteration.nodes ?? {})) {
    if (node !== undefined) reopenNode(node);
  }
}

function introducedPhaseIteration(input: StateMergeInput, phase: ParsedPhase, index: number): AmendableIteration {
  const taskIterations = phase.tasks.map((task, j) => introducedTaskIteration(input, task, j));
  return amendmentBorn(
    buildPhaseIterationEntry({
      index,
      phase,
      docPath: docPathOf(input, 'phases', phaseFilename(input.projectName, phase)),
      taskIterations,
    }),
    input.mergePlan.amendmentIndex,
  );
}

function introducedTaskIteration(input: StateMergeInput, task: ParsedTask, index: number): AmendableIteration {
  return amendmentBorn(
    buildTaskIterationEntry({
      index,
      task,
      docPath: docPathOf(input, 'tasks', taskFilename(input.projectName, task)),
    }),
    input.mergePlan.amendmentIndex,
  );
}

/**
 * The amendment marker's state half. The shared builders keep producing exactly
 * what explosion produces for planned and amendment-born iterations alike, so the
 * key is added after they return.
 */
function amendmentBorn(entry: IterationEntry, amendmentIndex: number): AmendableIteration {
  return {
    ...entry,
    // The builders type an iteration's `nodes` map opaquely; this one was just
    // built by them, so reading it back through this module's view is a widening.
    nodes: entry.nodes as Record<string, AmendableNode>,
    amendment: amendmentIndex,
  };
}

function docPathOf(input: StateMergeInput, dir: string, fileName: string): string {
  return toRelativeDocPath(path.join(input.projectDir, dir, fileName), input.projectDir);
}

// ── Reopening the downstream ─────────────────────────────────────────────────

/**
 * Reset everything the amendment invalidated, walking the cascade the merge
 * checker computed. Its entries were filtered against this project's own state, so
 * an id absent from the graph is one that lives inside a phase iteration — or one
 * this tier never declared — and is simply skipped here.
 *
 * The cursor is cleared to `null` whenever this walk genuinely invalidated the
 * position it already held, because an apply leaves no node active — the next
 * walk establishes the real one. A revise or a drop always invalidates: cursor
 * translation can follow a task that moved, but a dropped task has no new index —
 * a surviving cursor would silently retarget whichever task slid into that slot —
 * and a revised task's own iteration was just reset to unrun, so a cursor still
 * sitting inside it would resume work on content that no longer exists. On a
 * purely additive amendment, downgrading `phase_loop`, or a running phase's
 * `task_loop`, out of `completed` is the remaining signal: every other node the
 * cascade touches can only carry a non-`not_started` status when one of those two
 * downgrades also fired. An amendment that neither revises nor drops anything and
 * downgrades neither invalidates nothing, so a deep in-progress cursor survives
 * it — translated to its new indices if the merge renumbered the phase or task it
 * names, since the stale string would otherwise point at a different slot than
 * the run is in.
 */
function reopenDownstream(
  state: AmendableState,
  existing: ParsedMasterPlan,
  mergePlan: AmendmentMergePlan,
  phaseLoop: AmendableNode,
  amendedPhases: Set<number>,
): void {
  // Revise and drop always invalidate the position the run held. Cursor
  // translation can follow a task that MOVED, but a dropped task has no new
  // index — a surviving cursor would silently retarget whichever task slid
  // into that slot.
  const destructive =
    mergePlan.revisesTasks.length > 0 ||
    mergePlan.dropsTasks.length > 0 ||
    mergePlan.dropsPhases.length > 0;
  let cursorInvalidated = destructive;

  for (const id of mergePlan.reopens) {
    const node = state.graph.nodes[id];
    if (node === undefined) continue;
    if (id === PHASE_LOOP) {
      // The loop reopens rather than restarts: its completed iterations are
      // finished history, and only the new ones are unrun.
      if (node.status === COMPLETED) {
        node.status = IN_PROGRESS;
        cursorInvalidated = true;
      }
      continue;
    }
    reopenNode(node);
    if (id === FINAL_REVIEW) clearFinalReviewJudgement(node);
  }

  for (const slot of amendedPhases) {
    const iteration = phaseLoop.iterations?.[slot];
    // A phase that has not started yet carries nothing to reopen; one that is
    // running has judged its old task set and must judge the new one.
    if (iteration === undefined || iteration.status !== IN_PROGRESS) continue;

    const taskLoop = iteration.nodes?.[TASK_LOOP];
    if (taskLoop?.status === COMPLETED) {
      taskLoop.status = IN_PROGRESS;
      cursorInvalidated = true;
    }

    for (const id of mergePlan.reopens) {
      const node = iteration.nodes?.[id];
      if (node !== undefined) reopenNode(node);
    }
  }

  if (cursorInvalidated) {
    // No node is active once this walk lands: the cascade just sent the
    // reopened nodes back to unrun, and any phase the amendment added is
    // not_started with nothing walked into it. The next signal's walk
    // establishes the real cursor.
    state.graph.current_node_path = null;
  } else if (typeof state.graph.current_node_path === 'string') {
    // Nothing was reset, so the node the cursor names is as active as it was —
    // but a phase or task inserted ahead of it moved it to a new array index.
    const renumbered = renumberedCurrentNodePath(state.graph.current_node_path, existing, mergePlan);
    if (renumbered !== null) state.graph.current_node_path = renumbered;
  }

  // A graph the walker marked completed claims there is no unfinished work. The
  // amendment has just introduced some.
  if (state.graph.status === COMPLETED) state.graph.status = IN_PROGRESS;
}

/** A cursor's iteration coordinates: its phase index, and its task index when it names one. */
const CURSOR_COORDINATES_RE = /^phase_loop\[(\d+)\](?:\.task_loop\[(\d+)\])?/;

/**
 * The same cursor with its embedded array indices translated to where this merge
 * put that phase and task, or null when neither moved.
 *
 * Only the indices are rewritten; the rest of the path is the caller's, including
 * whatever node it names inside the iteration. A path outside `phase_loop` names a
 * singleton, which is never renumbered, and never matches.
 */
function renumberedCurrentNodePath(
  cursor: string,
  existing: ParsedMasterPlan,
  mergePlan: AmendmentMergePlan,
): string | null {
  const match = CURSOR_COORDINATES_RE.exec(cursor);
  if (match === null) return null;

  const oldPhaseIndex = Number(match[1]!);
  const newPhaseId = mergePlan.numbering.phases.get(phaseId(oldPhaseIndex + 1));
  if (newPhaseId === undefined) return null;
  const newPhaseIndex = iterationIndexOf(newPhaseId);
  if (newPhaseIndex === null) return null;

  let rewritten = cursor;
  let moved = false;

  if (newPhaseIndex !== oldPhaseIndex) {
    rewritten = rewritten.replace(`phase_loop[${oldPhaseIndex}]`, `phase_loop[${newPhaseIndex}]`);
    moved = true;
  }

  const rawTaskIndex = match[2];
  if (rawTaskIndex !== undefined) {
    const oldTaskIndex = Number(rawTaskIndex);
    // The numbering map is keyed by the id the pre-merge plan gives each task
    // (see `rebuildTaskIterations` above), so the key is read off that plan at
    // this position rather than synthesized from it — the two only agree while
    // the plan restarts its task numbering in every phase.
    const oldTaskId = existing.phases[oldPhaseIndex]?.tasks[oldTaskIndex]?.id
      ?? taskId(oldPhaseIndex + 1, oldTaskIndex + 1);
    const newTaskId = mergePlan.numbering.tasks.get(oldTaskId);
    const newTaskIndex = newTaskId === undefined ? null : iterationIndexOf(newTaskId);
    if (newTaskIndex !== null && newTaskIndex !== oldTaskIndex) {
      rewritten = rewritten.replace(`task_loop[${oldTaskIndex}]`, `task_loop[${newTaskIndex}]`);
      moved = true;
    }
  }

  return moved ? rewritten : null;
}

/** The 0-based iteration index a plan anchor's trailing number names — `P03` → 2, `P03-T01` → 0. */
function iterationIndexOf(anchor: string): number | null {
  const digits = /(\d+)$/.exec(anchor);
  return digits === null ? null : Number(digits[1]!) - 1;
}

function reopenNode(node: AmendableNode): void {
  node.status = NOT_STARTED;
  if (node.kind === 'gate') node.gate_active = false;
}

/**
 * A reopened final review must not keep tinting anything with the judgement it
 * already made. Its corrective entries stay as audit history; advancing the budget
 * origin to the current length is what empties the retry window, so the walker's
 * windowed check sees a clean slate rather than a stale completed corrective — the
 * same seam the `final_corrective_requested` mutation uses.
 */
function clearFinalReviewJudgement(node: AmendableNode): void {
  node.doc_path = null;
  node.verdict = null;
  node.corrective_budget_origin = (node.corrective_tasks ?? []).length;
}

/**
 * Restore a running shape after a halt that landed on the final review step.
 *
 * The engine's allowed-transition map treats `halted` as terminal with an empty
 * successor set, and its validator flags a move out of it — but that check compares
 * the state before and after a SINGLE `processEvent` call. `apply` writes state.json
 * directly, exactly as the explosion subcommand does, so it is not inside an event
 * boundary: the next `pipeline signal` reads the amended state as its baseline and
 * sees no transition at all. Moving this into the mutation registry would put it
 * inside that boundary and break the transaction.
 */
function clearFinalScopeHalt(state: AmendableState): void {
  const pipeline = state.pipeline;
  if (pipeline === undefined) {
    throw internalError('state.json carries no pipeline section, so its halt cannot be cleared');
  }
  state.graph.status = IN_PROGRESS;
  pipeline.halt_reason = null;
  pipeline.current_tier = EXECUTION_TIER;
}

// ── The record ───────────────────────────────────────────────────────────────

/** Append this amendment to the project's record and stamp the write. */
function recordAmendment(state: AmendableState, input: StateMergeInput): void {
  const project = state.project;
  if (project === undefined) {
    throw internalError('state.json carries no project section, so the amendment has nowhere to be recorded');
  }
  const amendments = project.amendments ?? [];
  amendments.push({
    index: input.mergePlan.amendmentIndex,
    doc_path: input.amendmentDocPath,
    applied: input.nowIso,
    adds_phases: input.mergePlan.addsPhases.map(phase => phase.id),
    adds_tasks: input.mergePlan.addsTasks.map(task => task.id),
    revises_tasks: input.mergePlan.revisesTasks.map(task => task.id),
    drops_tasks: [...input.mergePlan.dropsTasks],
    drops_phases: [...input.mergePlan.dropsPhases],
  });
  project.amendments = amendments;
  project.updated = input.nowIso;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function place<T>(slots: (T | undefined)[], index: number, what: string, value: T): void {
  if (index < 0 || index >= slots.length) {
    throw internalError(`${what} lands outside the merged plan's ${slots.length} slot(s)`);
  }
  if (slots[index] !== undefined) throw internalError(`two iterations claim ${what}`);
  slots[index] = value;
}

function internalError(detail: string): Error {
  return new Error(`merge-state: ${detail}`);
}
