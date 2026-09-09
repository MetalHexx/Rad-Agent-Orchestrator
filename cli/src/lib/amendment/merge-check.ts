/**
 * The amendment merge checker — the validation core, and the decision record.
 *
 * `buildMergePlan` is pure: it takes parsed documents plus the frontier and
 * touches no filesystem. What it returns on the happy path is not merely a
 * report for a human to read — it is the numbering plan and reopen cascade that
 * the writers executing the amendment run off. They are computed once, here,
 * and handed down; nobody re-derives them.
 *
 * Every error it raises carries a file-absolute line against the AMENDMENT
 * document, matching what `parseMasterPlan` throws, so an author is always sent
 * to the right line of the file they just wrote.
 */

import type { ParsedMasterPlan, ParsedPhase, ParsedTask } from '../explode-master-plan.js';
import type { Frontier, PipelineState } from './frontier.js';
import { nextAmendmentIndex, phaseId, taskId } from './frontier.js';
import type { AmendmentFrontmatter } from './parse.js';
import { readAmendmentFrontmatter } from './parse.js';

// ── The shared value ─────────────────────────────────────────────────────────

export interface MergeError {
  line: number;
  expected: string;
  found: string;
  message: string;
}

export interface AmendmentMergePlan {
  amendmentIndex: number;
  addsPhases: { id: string; title: string; taskCount: number }[];
  addsTasks: { id: string; title: string; repo: string }[];
  /** Tasks restated in place, at their MERGED ids, in merged order. */
  revisesTasks: { id: string; title: string; repo: string }[];
  /** Task ids removed, in the numbering the plan held before this merge, ascending. */
  dropsTasks: string[];
  /** Phase ids removed, in the numbering the plan held before this merge, ascending. */
  dropsPhases: string[];
  /** Final position of every phase and task in the merged plan, old id → new id.
   *  Identity entries included, so a writer never has to work out "did this move?".
   *  A dropped phase or task carries no entry at all — that absence is the signal
   *  the writers read; a revised task keeps its identity (or moved) entry exactly
   *  like any other carried-through task. */
  numbering: { phases: Map<string, string>; tasks: Map<string, string> };
  /** Old id → new id for the entries that actually moved. The operator-facing subset of `numbering`. */
  renumbered: { from: string; to: string }[];
  /** The node ids a reopen may touch on this tier, earliest first — filtered to nodes
   *  the project's state actually carries, which is how a tier that declares no phase
   *  review is handled without reading a template file. Presence is all this says: a
   *  node named here is one `apply` will visit, not one it will necessarily change.
   *  `reopenDownstream` decides per apply whether resetting each one alters anything. */
  reopens: string[];
  clearsHalt: { node: string; reason: string } | null;
  mergedTotals: { phases: number; tasks: number };
  mergedRepos: string[];
}

export type AmendmentMergeOutcome =
  | { type: 'ok'; plan: AmendmentMergePlan }
  | { type: 'invalid'; error: MergeError }
  | { type: 'blocked'; blocked: { haltedNode: string; reason: string; message: string } };

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Where a frontmatter-level complaint points. `buildMergePlan` is pure and holds
 * no raw document text, so it cannot locate an individual key — but the
 * frontmatter block always opens on file line 1, which is the right file and the
 * right region.
 */
const AMENDMENT_FRONTMATTER_LINE = 1;

/** Mirrors the Master Plan parser's own detection of the line's presence. */
const TARGET_REPO_LINE_RE = /\*\*Target repo:\*\*/;

/**
 * Every node an applied amendment reopens, in pipeline order. New work lands
 * inside `phase_loop`, so the loop itself and everything downstream of it must
 * go back to `not_started`. The list is filtered against the project's own state
 * before it is reported: a `low`- or `high`-tier project declares no
 * `phase_review` or `phase_gate`, and a run that never reached the PR branch has
 * no `final_pr`.
 */
const REOPEN_CASCADE = [
  'phase_loop',
  'phase_review',
  'phase_gate',
  'final_review',
  'pr_gate',
  'final_pr',
  'final_approval_gate',
] as const;

const HALTED = 'halted';
const DEFAULT_HALT_REASON = 'no halt reason recorded';

// ── Working model ────────────────────────────────────────────────────────────

interface WorkingTask {
  /** Existing-plan id, or null for a task the amendment adds. */
  originalId: string | null;
  title: string;
  repos: string[];
  /** True when a `revises_tasks` block restated this (necessarily pre-existing) task. */
  revised: boolean;
}

interface WorkingPhase {
  /** Existing-plan id and 1-based index; both null for a phase the amendment adds. */
  originalId: string | null;
  originalIndex: number | null;
  title: string;
  tasks: WorkingTask[];
}

// ── The core ─────────────────────────────────────────────────────────────────

/**
 * Validate an amendment against the plan it amends and produce the merge plan.
 *
 * Checks run outermost-first: a halt blocks everything, then the frontmatter's
 * own amendment index, then the amendment's blocks, then the rest of its
 * self-declarations, then positional insertion against the frontier, then repo
 * scope across the merged result.
 */
export function buildMergePlan(input: {
  existing: ParsedMasterPlan;
  amendment: ParsedMasterPlan;
  frontier: Frontier;
  state: PipelineState;
}): AmendmentMergeOutcome {
  const { existing, amendment, frontier, state } = input;

  const halt = frontier.upstreamHalt;
  if (halt !== null) {
    return {
      type: 'blocked',
      blocked: {
        haltedNode: halt.node,
        reason: halt.reason,
        message: `Cannot amend this project: ${halt.node} is halted (${halt.reason}). Clear that halt before amending — only a halt on the final review step is recoverable this way.`,
      },
    };
  }

  const declarations = readAmendmentFrontmatter(amendment.frontmatter);
  if (declarations.amendmentIndex === null) {
    return invalid({
      line: AMENDMENT_FRONTMATTER_LINE,
      expected: 'a positive integer "amendment:" index in the frontmatter',
      found: describeValue(amendment.frontmatter['amendment']),
      message: 'The amendment frontmatter is missing a positive integer "amendment:" index',
    });
  }

  const expectedIndex = nextAmendmentIndex(state);
  if (declarations.amendmentIndex !== expectedIndex) {
    return invalid({
      line: AMENDMENT_FRONTMATTER_LINE,
      expected: `amendment index ${expectedIndex} (the next one this project has not yet applied)`,
      found: String(declarations.amendmentIndex),
      message:
        `The amendment frontmatter declares index ${declarations.amendmentIndex}, but ` +
        (expectedIndex === 1
          ? 'this project has not applied any amendments yet'
          : `this project has already applied through index ${expectedIndex - 1}`) +
        '. Re-applying an applied index, or skipping ahead, would corrupt the amendment record.',
    });
  }

  const blockChecks = checkAmendmentBlocks(amendment);
  if (blockChecks !== null) return blockChecks;

  const declarationChecks = checkDeclarations(existing, amendment, declarations);
  if (declarationChecks !== null) return declarationChecks;

  const merged = mergePositions(existing, amendment, declarations, frontier);
  if ('type' in merged) return merged;

  const repoCheck = checkMergedRepos(existing, amendment, merged.phases, state);
  if ('type' in repoCheck) return repoCheck;

  const presentNodeIds = stateNodeIds(state);
  return {
    type: 'ok',
    plan: {
      amendmentIndex: declarations.amendmentIndex,
      ...renumber(merged.phases),
      dropsTasks: merged.dropsTasks,
      dropsPhases: merged.dropsPhases,
      reopens: REOPEN_CASCADE.filter(id => presentNodeIds.has(id)),
      clearsHalt: readFinalReviewHalt(state),
      mergedTotals: {
        phases: merged.phases.length,
        tasks: merged.phases.reduce((sum, phase) => sum + phase.tasks.length, 0),
      },
      mergedRepos: repoCheck.mergedRepos,
    },
  };
}

// ── Block-level checks ───────────────────────────────────────────────────────

/**
 * The two target-repo presence checks, re-implemented against the amendment.
 *
 * The Master Plan parser gates its entire target-repo enforcement block on a
 * non-empty frontmatter `repos:` seal, and an amendment deliberately carries no
 * seal — so on this document none of the parser's errors can fire. Both checks
 * matter: without the empty-line check, the merged repo containment check below
 * passes vacuously, because an empty `targetRepos` array has nothing to reject.
 */
function checkAmendmentBlocks(amendment: ParsedMasterPlan): AmendmentMergeOutcome | null {
  const seenPhaseIds = new Set<string>();

  for (const phase of amendment.phases) {
    if (seenPhaseIds.has(phase.id)) {
      return invalid({
        line: phase.startLine,
        expected: 'each phase to appear at most once in the amendment',
        found: `a second "${phase.id}" block`,
        message: `The amendment declares phase ${phase.id} more than once`,
      });
    }
    seenPhaseIds.add(phase.id);

    const seenTaskIds = new Set<string>();
    for (const task of phase.tasks) {
      if (seenTaskIds.has(task.id)) {
        return invalid({
          line: task.startLine,
          expected: 'each task to appear at most once in the amendment',
          found: `a second "${task.id}" block`,
          message: `The amendment declares task ${task.id} more than once`,
        });
      }
      seenTaskIds.add(task.id);

      if (!TARGET_REPO_LINE_RE.test(task.body)) {
        return invalid({
          line: task.startLine,
          expected: 'a "**Target repo:**" line on every task',
          found: `task ${task.id} with no Target repo line`,
          message: `Task ${task.id} is missing its "**Target repo:**" line`,
        });
      }
      if (task.targetRepos.length === 0) {
        return invalid({
          line: task.startLine,
          expected: 'at least one repo name on the "**Target repo:**" line',
          found: `task ${task.id} with an empty Target repo line`,
          message: `Task ${task.id} has a present-but-empty "**Target repo:**" line`,
        });
      }
    }
  }

  return null;
}

/**
 * Cross-check the frontmatter's declarations against the blocks actually
 * present, for all five verbs.
 *
 * `adds_phases` is load-bearing, not decorative: it is the only thing that tells
 * a `## P02` block that inserts a brand-new phase apart from a `## P02` block
 * that restates an existing phase so it can host a new or revised task. A block
 * not named there must therefore match a phase of the existing plan.
 *
 * Every task block must resolve to exactly one of `adds_tasks` or
 * `revises_tasks` — naming it in both means opposite things at one id, and
 * naming it in neither leaves the block's intent undeclared. `drops_tasks`
 * names ids the amendment removes outright, so a dropped id may carry no block
 * at all — carrying one means the author meant one of the other two verbs.
 * `drops_phases` only asserts phase ids the existing plan holds; whether the
 * merge's drops actually empty them is checked once the drops are applied.
 */
function checkDeclarations(
  existing: ParsedMasterPlan,
  amendment: ParsedMasterPlan,
  declarations: AmendmentFrontmatter,
): AmendmentMergeOutcome | null {
  const { addsPhases, addsTasks, revisesTasks, dropsTasks, dropsPhases } = declarations;

  const blockPhaseIds = new Set(amendment.phases.map(phase => phase.id));
  const existingPhaseIds = new Set(existing.phases.map(phase => phase.id));

  for (const declared of addsPhases) {
    if (!blockPhaseIds.has(declared)) {
      return invalid({
        line: AMENDMENT_FRONTMATTER_LINE,
        expected: 'a "## P{NN}:" block for every id in adds_phases',
        found: `adds_phases names ${declared}, which has no block`,
        message: `The amendment's adds_phases declares ${declared} but the body carries no ${declared} block`,
      });
    }
  }

  const addedPhaseIds = new Set(addsPhases);
  for (const phase of amendment.phases) {
    if (addedPhaseIds.has(phase.id) || existingPhaseIds.has(phase.id)) continue;
    return invalid({
      line: phase.startLine,
      expected: 'a phase block that is either declared in adds_phases or restates an existing phase',
      found: phase.id,
      message: `Amendment phase ${phase.id} is neither declared in adds_phases nor present in the existing plan`,
    });
  }

  const declaredAddIds = new Set(addsTasks);
  const declaredReviseIds = new Set(revisesTasks);
  const declaredDropIds = new Set(dropsTasks);

  for (const phase of amendment.phases) {
    for (const task of phase.tasks) {
      if (declaredDropIds.has(task.id)) {
        return invalid({
          line: task.startLine,
          expected: 'a dropped task id to carry no block in the amendment body',
          found: `${task.id}, which carries a block though drops_tasks names it`,
          message: `Task ${task.id} is declared in drops_tasks but also carries a block — a drop removes a task and carries no content, so this task means one of the other two verbs`,
        });
      }
      const isAdd = declaredAddIds.has(task.id);
      const isRevise = declaredReviseIds.has(task.id);
      if (isAdd && isRevise) {
        return invalid({
          line: task.startLine,
          expected: 'a task block declared in exactly one of adds_tasks or revises_tasks',
          found: `${task.id}, named in both`,
          message: `Task ${task.id} is declared in both adds_tasks and revises_tasks — the two declarations mean opposite things at an occupied id`,
        });
      }
      if (!isAdd && !isRevise) {
        return invalid({
          line: task.startLine,
          expected: 'every task block to be declared in adds_tasks or revises_tasks',
          found: `${task.id}, which neither declares`,
          message: `Task ${task.id} appears in the amendment body but is declared in neither adds_tasks nor revises_tasks`,
        });
      }
    }
  }

  const blockTaskIds = new Set(amendment.phases.flatMap(phase => phase.tasks.map(task => task.id)));

  const undeliveredAdds = addsTasks.filter(id => !blockTaskIds.has(id));
  if (undeliveredAdds.length > 0) {
    return invalid({
      line: AMENDMENT_FRONTMATTER_LINE,
      expected: 'a "### P{NN}-T{MM}:" block for every id in adds_tasks',
      found: `adds_tasks names ${undeliveredAdds.join(', ')} with no matching block`,
      message: `The amendment's adds_tasks declares ${undeliveredAdds.join(', ')} but the body carries no matching task block`,
    });
  }

  const undeliveredRevises = revisesTasks.filter(id => !blockTaskIds.has(id));
  if (undeliveredRevises.length > 0) {
    return invalid({
      line: AMENDMENT_FRONTMATTER_LINE,
      expected: 'a "### P{NN}-T{MM}:" block for every id in revises_tasks',
      found: `revises_tasks names ${undeliveredRevises.join(', ')} with no matching block`,
      message: `The amendment's revises_tasks declares ${undeliveredRevises.join(', ')} but the body carries no matching task block`,
    });
  }

  const existingTaskIds = new Set(existing.phases.flatMap(phase => phase.tasks.map(task => task.id)));

  const unknownRevises = revisesTasks.filter(id => !existingTaskIds.has(id));
  if (unknownRevises.length > 0) {
    return invalid({
      line: AMENDMENT_FRONTMATTER_LINE,
      expected: 'every id in revises_tasks to name a task the existing plan holds',
      found: `revises_tasks names ${unknownRevises.join(', ')}, which the existing plan does not hold`,
      message: `The amendment's revises_tasks declares ${unknownRevises.join(', ')} but the existing plan holds no such task`,
    });
  }

  const unknownDrops = dropsTasks.filter(id => !existingTaskIds.has(id));
  if (unknownDrops.length > 0) {
    return invalid({
      line: AMENDMENT_FRONTMATTER_LINE,
      expected: 'every id in drops_tasks to name a task the existing plan holds',
      found: `drops_tasks names ${unknownDrops.join(', ')}, which the existing plan does not hold`,
      message: `The amendment's drops_tasks declares ${unknownDrops.join(', ')} but the existing plan holds no such task`,
    });
  }

  const unknownDropPhases = dropsPhases.filter(id => !existingPhaseIds.has(id));
  if (unknownDropPhases.length > 0) {
    return invalid({
      line: AMENDMENT_FRONTMATTER_LINE,
      expected: 'every id in drops_phases to name a phase the existing plan holds',
      found: `drops_phases names ${unknownDropPhases.join(', ')}, which the existing plan does not hold`,
      message: `The amendment's drops_phases declares ${unknownDropPhases.join(', ')} but the existing plan holds no such phase`,
    });
  }

  return null;
}

// ── Revise, drop, and positional insertion ──────────────────────────────────

/**
 * Merge the amendment into the existing plan's working model, in a fixed order:
 * revise in place (nothing moves), then drop (everything behind a removal shifts
 * up, and an emptied phase vanishes), then splice the additions in ascending
 * declared order against the list those two left.
 *
 * `revises_tasks` and `drops_tasks` name ids in the plan as it stands today, so
 * they run first, against the untouched existing structure. Added block
 * positions are declared against the plan those two leave behind — the whole
 * point of running them first — so the splice step below is unchanged from
 * before revise and drop existed, beyond reading only the blocks `adds_tasks`
 * actually names.
 *
 * Numbering stays continuous and positional. A number that is free (exactly one
 * past the end) appends. A number held by editable content displaces it and
 * everything after it upward. A number held by frozen content, or beyond one
 * past the end, is a merge-level error — the whole point of the frontier is that
 * work something already references is never renumbered.
 */
function mergePositions(
  existing: ParsedMasterPlan,
  amendment: ParsedMasterPlan,
  declarations: AmendmentFrontmatter,
  frontier: Frontier,
): { phases: WorkingPhase[]; dropsTasks: string[]; dropsPhases: string[] } | AmendmentMergeOutcome {
  const addedPhaseIds = new Set(declarations.addsPhases);
  const addedTaskIds = new Set(declarations.addsTasks);
  const revisedTaskIds = new Set(declarations.revisesTasks);
  const declaredDropPhaseIds = new Set(declarations.dropsPhases);

  let phases: WorkingPhase[] = existing.phases.map(phase => ({
    originalId: phase.id,
    originalIndex: phase.index,
    title: phase.title,
    tasks: phase.tasks.map(task => ({
      originalId: task.id,
      title: task.title,
      repos: task.targetRepos,
      revised: false,
    })),
  }));

  // ── Revise in place ──────────────────────────────────────────────────────
  const revisionBlocks = new Map<string, ParsedTask>();
  for (const phaseBlock of amendment.phases) {
    for (const task of phaseBlock.tasks) {
      if (revisedTaskIds.has(task.id)) revisionBlocks.set(task.id, task);
    }
  }
  for (const id of declarations.revisesTasks) {
    const block = revisionBlocks.get(id);
    if (block === undefined) continue; // checkDeclarations already proved this exists.
    if (frontier.taskEditable.get(id) !== true) {
      return frozenTaskRefusal(id, block.startLine, 'revised', 'rewritten', frontier);
    }
    const working = findWorkingTask(phases, id);
    if (working === undefined) continue; // checkDeclarations already proved this exists.
    working.title = block.title;
    working.repos = block.targetRepos;
    working.revised = true;
  }

  // ── Drop ─────────────────────────────────────────────────────────────────
  const droppedFromPhase = new Set<number>();
  for (const id of declarations.dropsTasks) {
    if (frontier.taskEditable.get(id) !== true) {
      return frozenTaskRefusal(id, AMENDMENT_FRONTMATTER_LINE, 'dropped', 'removed', frontier);
    }
    const owner = phases.find(phase => phase.tasks.some(task => task.originalId === id));
    if (owner === undefined) continue; // checkDeclarations already proved this exists.
    owner.tasks = owner.tasks.filter(task => task.originalId !== id);
    if (owner.originalIndex !== null) droppedFromPhase.add(owner.originalIndex);
  }

  // ── Phase removal ────────────────────────────────────────────────────────
  // Only a phase this amendment actually dropped tasks from, and that now holds
  // none, is a candidate — a pre-existing empty phase the amendment never
  // touched is left alone.
  const computedRemovals = new Set<string>();
  for (const phase of phases) {
    if (phase.originalId === null || phase.originalIndex === null) continue;
    if (droppedFromPhase.has(phase.originalIndex) && phase.tasks.length === 0) {
      computedRemovals.add(phase.originalId);
    }
  }

  for (const id of computedRemovals) {
    const phase = phases.find(p => p.originalId === id);
    if (phase?.originalIndex == null) continue;
    if (frontier.phaseBriefEditable.get(phase.originalIndex) !== true) {
      const reason = frontier.phaseFrozenReason.get(phase.originalIndex) ?? 'already worked';
      return invalid({
        line: AMENDMENT_FRONTMATTER_LINE,
        expected: 'a phase whose brief is still editable',
        found: `${id}, which is frozen (${reason})`,
        message: `Phase ${id} cannot be removed: it is ${reason}, and a phase already reviewed is never removed`,
      });
    }
  }

  for (const id of computedRemovals) {
    if (!declaredDropPhaseIds.has(id)) {
      return invalid({
        line: AMENDMENT_FRONTMATTER_LINE,
        expected: 'drops_phases to name every phase this amendment empties',
        found: `${id} is emptied by this amendment's drops, but drops_phases does not name it`,
        message: `Phase ${id} would hold no tasks after this amendment's drops, but drops_phases does not declare it — a vanishing phase is asserted, not inferred`,
      });
    }
  }
  for (const id of declaredDropPhaseIds) {
    if (!computedRemovals.has(id)) {
      return invalid({
        line: AMENDMENT_FRONTMATTER_LINE,
        expected: 'drops_phases to name only phases this amendment actually empties',
        found: `${id} is named in drops_phases, but this amendment's drops leave it holding at least one task`,
        message: `drops_phases declares ${id} removed, but this amendment does not empty it`,
      });
    }
  }

  phases = phases.filter(phase => phase.originalId === null || !computedRemovals.has(phase.originalId));

  // ── Splice the additions ────────────────────────────────────────────────
  // Insertions run in ascending declared order so each one's "free" position is
  // measured against the list as the earlier insertions already left it.
  const addedBlocks = amendment.phases
    .filter(phase => addedPhaseIds.has(phase.id))
    .sort((a, b) => a.index - b.index);

  const placements = new Map<ParsedPhase, WorkingPhase>();

  for (const block of addedBlocks) {
    const free = phases.length + 1;
    if (block.index > free) {
      return invalid({
        line: block.startLine,
        expected: `a phase number no higher than ${phaseId(free)}`,
        found: block.id,
        message: `Phase ${block.id} leaves a gap: the merged plan holds ${phases.length} phases, so ${phaseId(free)} is the highest number a new phase may claim`,
      });
    }
    if (block.index < free) {
      const occupant = phases[block.index - 1];
      if (occupant.originalIndex !== null && frontier.phaseBriefEditable.get(occupant.originalIndex) !== true) {
        return invalid({
          line: block.startLine,
          expected: describeEditablePhaseFloor(frontier, free),
          found: `${block.id}, whose position is held by frozen phase ${occupant.originalId}`,
          message: `Phase ${block.id} cannot be inserted: position ${block.id} is held by ${occupant.originalId}, which is frozen and must not be renumbered`,
        });
      }
    }
    const placed: WorkingPhase = { originalId: null, originalIndex: null, title: block.title, tasks: [] };
    phases.splice(block.index - 1, 0, placed);
    placements.set(block, placed);
  }

  for (const block of amendment.phases) {
    const isNewPhase = addedPhaseIds.has(block.id);
    const target = isNewPhase
      ? placements.get(block)
      : phases.find(phase => phase.originalId === block.id);
    // A restated phase whose drops emptied it and removed it entirely carries
    // no target here — its added tasks, if any, have nowhere left to land.
    if (target === undefined) continue;

    const addedTasksInBlock = block.tasks.filter(task => addedTaskIds.has(task.id));

    // A phase whose brief is frozen may not gain tasks at all — its review
    // already judged its exit criteria against the task set it had. Revised or
    // dropped tasks do not trip this: they are gated by task editability alone.
    if (!isNewPhase && addedTasksInBlock.length > 0) {
      const editable = target.originalIndex !== null && frontier.phaseBriefEditable.get(target.originalIndex) === true;
      if (!editable) {
        return invalid({
          line: block.startLine,
          expected: 'tasks to be added only to a phase whose brief is still editable',
          found: `${block.id}, which is frozen`,
          message: `Phase ${block.id} cannot gain tasks: its brief is frozen, and its review already judged its exit criteria`,
        });
      }
    }

    const orderedTasks = [...addedTasksInBlock].sort((a, b) => a.taskIndex - b.taskIndex);
    for (const task of orderedTasks) {
      const free = target.tasks.length + 1;
      if (task.taskIndex > free) {
        return invalid({
          line: task.startLine,
          expected: `a task number no higher than ${taskId(block.index, free)}`,
          found: task.id,
          message: `Task ${task.id} leaves a gap: ${block.id} holds ${target.tasks.length} tasks, so ${taskId(block.index, free)} is the highest number a new task may claim`,
        });
      }
      if (task.taskIndex < free) {
        const occupant = target.tasks[task.taskIndex - 1];
        if (occupant.originalId !== null && frontier.taskEditable.get(occupant.originalId) !== true) {
          return invalid({
            line: task.startLine,
            expected: 'a task position held by a task that has not started',
            found: `${task.id}, whose position is held by frozen task ${occupant.originalId}`,
            message: `Task ${task.id} cannot be inserted: position ${task.id} is held by ${occupant.originalId}, which has already been worked and must not be displaced`,
          });
        }
      }
      target.tasks.splice(task.taskIndex - 1, 0, {
        originalId: null,
        title: task.title,
        repos: task.targetRepos,
        revised: false,
      });
    }
  }

  return {
    phases,
    dropsTasks: [...declarations.dropsTasks].sort(),
    dropsPhases: [...computedRemovals].sort(),
  };
}

/** Find a not-yet-renumbered working task by its existing-plan id. */
function findWorkingTask(phases: WorkingPhase[], originalId: string): WorkingTask | undefined {
  for (const phase of phases) {
    const found = phase.tasks.find(task => task.originalId === originalId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * A revise or a drop aimed at frozen content — same shape as the existing
 * "position is held by frozen task" error, but pointing at the frontmatter line
 * for a drop, because a drop declaration carries no block to point at. A revise
 * error points at the revising block's own line instead, since that block
 * exists.
 */
function frozenTaskRefusal(
  id: string,
  line: number,
  action: 'dropped' | 'revised',
  consequence: 'removed' | 'rewritten',
  frontier: Frontier,
): AmendmentMergeOutcome {
  const reason = frontier.taskFrozenReason.get(id) ?? 'already worked';
  return invalid({
    line,
    expected: 'a task that has not started',
    found: `${id}, which is frozen (${reason})`,
    message: `Task ${id} cannot be ${action}: it is ${reason}, and work something already references is never ${consequence}`,
  });
}

function describeEditablePhaseFloor(frontier: Frontier, free: number): string {
  return frontier.firstEditablePhase === null
    ? `a new phase appended at ${phaseId(free)} — no existing phase is still editable`
    : `a phase number at or after ${phaseId(frontier.firstEditablePhase)}, the lowest still-editable phase`;
}

// ── Repo scope across the merged result ──────────────────────────────────────

/**
 * The merged plan's `repos:` array is derived, not accumulated: the union of
 * every merged working task's repos, ordered existing-seal-first (so a repo a
 * drop orphans falls out of the array — the seal shrinks) and then newcomers in
 * first-appearance order across the merged plan. A repo is only a legitimate
 * newcomer when the project's source control already provisions it, since a
 * task has nowhere to work otherwise; that check runs against every task block
 * the amendment carries (added or revised — a revision can change a task's
 * repo just as an added task can name one). Because the array is built from
 * what the merged tasks actually target, "merged but untargeted" cannot occur
 * by construction: there is no separate check for it.
 */
function checkMergedRepos(
  existing: ParsedMasterPlan,
  amendment: ParsedMasterPlan,
  phases: WorkingPhase[],
  state: PipelineState,
): { mergedRepos: string[] } | AmendmentMergeOutcome {
  const existingSeal = Array.isArray(existing.frontmatter['repos'])
    ? (existing.frontmatter['repos'] as unknown[]).map(String)
    : [];
  const sealed = new Set(existingSeal);
  const provisioned = new Set(
    (state.pipeline?.source_control?.repos ?? [])
      .map(repo => repo.name)
      .filter((name): name is string => typeof name === 'string'),
  );

  for (const phase of amendment.phases) {
    for (const task of phase.tasks) {
      for (const repo of task.targetRepos) {
        if (!sealed.has(repo) && !provisioned.has(repo)) {
          return invalid({
            line: task.startLine,
            expected: `a repo within the merged repos: [${existingSeal.join(', ')}]`,
            found: `task ${task.id} names "${repo}"`,
            message: `Task ${task.id} names repo "${repo}", which is neither in the Master Plan's repos: nor provisioned for this project — it would not be in the merged plan's repos:`,
          });
        }
      }
    }
  }

  const targeted = new Set<string>();
  const newcomers: string[] = [];
  for (const phase of phases) {
    for (const task of phase.tasks) {
      for (const repo of task.repos) {
        targeted.add(repo);
        if (!sealed.has(repo) && !newcomers.includes(repo)) newcomers.push(repo);
      }
    }
  }
  const mergedRepos = [...existingSeal.filter(repo => targeted.has(repo)), ...newcomers];

  return { mergedRepos };
}

// ── Final numbering ──────────────────────────────────────────────────────────

/**
 * Walk the merged list and record where everything landed. `numbering` carries
 * identity entries too, so a writer reads a final id for every old id rather
 * than working out whether something moved; `renumbered` is the subset that
 * did. A revised task keeps its `originalId`, so it lands in `numbering` and
 * `revisesTasks` alike, at its merged id, and never in `addsTasks`. A dropped
 * task is already absent from `phases` by the time this runs, so it lands in
 * none of these — that absence is the signal a writer reads.
 */
function renumber(
  phases: WorkingPhase[],
): Pick<AmendmentMergePlan, 'addsPhases' | 'addsTasks' | 'revisesTasks' | 'numbering' | 'renumbered'> {
  const numbering = { phases: new Map<string, string>(), tasks: new Map<string, string>() };
  const renumbered: { from: string; to: string }[] = [];
  const addsPhases: AmendmentMergePlan['addsPhases'] = [];
  const addsTasks: AmendmentMergePlan['addsTasks'] = [];
  const revisesTasks: AmendmentMergePlan['revisesTasks'] = [];

  phases.forEach((phase, phaseSlot) => {
    const mergedPhaseId = phaseId(phaseSlot + 1);
    if (phase.originalId === null) {
      addsPhases.push({ id: mergedPhaseId, title: phase.title, taskCount: phase.tasks.length });
    } else {
      numbering.phases.set(phase.originalId, mergedPhaseId);
      if (phase.originalId !== mergedPhaseId) renumbered.push({ from: phase.originalId, to: mergedPhaseId });
    }

    phase.tasks.forEach((task, taskSlot) => {
      const mergedTaskId = taskId(phaseSlot + 1, taskSlot + 1);
      if (task.originalId === null) {
        addsTasks.push({ id: mergedTaskId, title: task.title, repo: task.repos[0] ?? '' });
      } else {
        numbering.tasks.set(task.originalId, mergedTaskId);
        if (task.originalId !== mergedTaskId) renumbered.push({ from: task.originalId, to: mergedTaskId });
        if (task.revised) revisesTasks.push({ id: mergedTaskId, title: task.title, repo: task.repos[0] ?? '' });
      }
    });
  });

  return { addsPhases, addsTasks, revisesTasks, numbering, renumbered };
}

// ── State reads ──────────────────────────────────────────────────────────────

/**
 * Every node id the project's state carries: the top-level graph plus the nodes
 * scaffolded inside phase iterations, which is where a tier's `phase_review` and
 * `phase_gate` live.
 */
function stateNodeIds(state: PipelineState): Set<string> {
  const ids = new Set(Object.keys(state.graph?.nodes ?? {}));
  for (const iteration of state.graph?.nodes?.['phase_loop']?.iterations ?? []) {
    for (const nodeId of Object.keys(iteration.nodes ?? {})) ids.add(nodeId);
  }
  return ids;
}

/**
 * A halt on the final review step is the recoverable case: the amendment clears
 * it rather than being blocked by it. `computeFrontier` has already proven no
 * other halt is outstanding by the time this runs.
 */
function readFinalReviewHalt(state: PipelineState): { node: string; reason: string } | null {
  if (state.graph?.nodes?.['final_review']?.status !== HALTED) return null;
  return { node: 'final_review', reason: state.pipeline?.halt_reason ?? DEFAULT_HALT_REASON };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function invalid(error: MergeError): AmendmentMergeOutcome {
  return { type: 'invalid', error };
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'absent';
  return JSON.stringify(value) ?? String(value);
}
