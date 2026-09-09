/**
 * `radorch amendment status` — what an amendment may legally do to this project
 * right now, with no amendment document required.
 *
 * A pre-authoring read that replaces the applied-history-only `amendment list`:
 * the same applied history, plus the next amendment's index and filename, the
 * Requirements doc's sealed template and task size, and the frontier itself —
 * which phases and tasks are still editable, and why the rest are frozen. The
 * main agent reads this before writing a single line of the amendment itself,
 * rather than discovering the frontier only through `validate`'s rejection of
 * a document it already wrote.
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { parseMasterPlan } from '../../lib/explode-master-plan.js';
import { computeFrontier, nextAmendmentIndex, phaseId } from '../../lib/amendment/frontier.js';
import type { Frontier } from '../../lib/amendment/frontier.js';
import type { AmendableState, AmendableNode, AmendmentRecord } from '../../lib/amendment/merge-state.js';
import { guardProjectDir } from './validate.js';
import { parseYaml } from '../../lib/yaml.js';

/** The top-level node ids every shipped tier template declares, in template order. */
const TOP_LEVEL_NODE_ORDER = [
  'master_plan',
  'explode_master_plan',
  'plan_approval_gate',
  'gate_mode_selection',
  'phase_loop',
  'final_review',
  'pr_gate',
  'final_approval_gate',
] as const;

/** Where the pipeline is parked right now, for a consumer forbidden from reading state.json. */
export interface StoppingPoint {
  at:
    | 'awaiting_plan_approval'
    | 'phase_loop_not_started'
    | 'phase_loop_in_progress'
    | 'awaiting_final_review'
    | 'final_review_in_progress'
    | 'pr_gate'
    | 'final_approval_gate'
    | 'halted'
    | 'unknown';
  /** The top-level node id the value was derived from; null when 'unknown'. */
  node: string | null;
  /** One plain-language sentence a skill can relay to the operator. */
  detail: string;
}

export interface AmendmentStatusResult {
  /** What has already landed. The shape `amendment list` returned, unchanged. */
  applied: AmendmentRecord[];
  /** The document the next amendment must be written as. */
  next: { index: number; fileName: string };
  /** What the amendment must match. Read from the Requirements doc's frontmatter. */
  sealed: { template: string | null; taskSize: string | null };
  /** Lowest phase id insertion is legal at, or null when no phase is still editable. */
  firstEditablePhase: string | null;
  /** Where the pipeline is parked right now, for a consumer forbidden from reading state.json. */
  stoppingPoint: StoppingPoint;
  phases: {
    id: string;
    title: string;
    editable: boolean;
    /** Why it is frozen, or null when editable. */
    frozenReason: string | null;
    tasks: {
      id: string;
      title: string;
      repo: string;
      editable: boolean;
      frozenReason: string | null;
    }[];
  }[];
}

export interface AmendmentStatusOptions {
  projectDir: string;
}

export function amendmentStatus(opts: AmendmentStatusOptions): AmendmentStatusResult {
  guardProjectDir(opts.projectDir);
  const statePath = path.join(opts.projectDir, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as AmendableState;

  const masterPlanPath = resolveMasterPlanPath(opts.projectDir, state);
  if (masterPlanPath === null) {
    throw new Error(
      `No Master Plan recorded at graph.nodes.master_plan.doc_path in ${statePath} — there is nothing to amend`,
    );
  }

  const plan = parseMasterPlan(masterPlanPath);
  const frontier = computeFrontier(state, plan);
  const projectName = resolveProjectName(opts.projectDir, state);

  const recorded = state.project?.amendments ?? [];
  const applied: AmendmentRecord[] = recorded.map(entry => ({
    index: entry.index,
    doc_path: entry.doc_path,
    applied: entry.applied,
    adds_phases: entry.adds_phases ?? [],
    adds_tasks: entry.adds_tasks ?? [],
    revises_tasks: entry.revises_tasks ?? [],
    drops_tasks: entry.drops_tasks ?? [],
    drops_phases: entry.drops_phases ?? [],
  }));

  const nextIndex = nextAmendmentIndex(state);
  const next = { index: nextIndex, fileName: `${projectName}-AMENDMENT-${pad2(nextIndex)}.md` };

  const sealed = readSealedRequirements(resolveRequirementsPath(opts.projectDir, projectName, state));

  const firstEditablePhase =
    frontier.firstEditablePhase === null ? null : phaseId(frontier.firstEditablePhase);

  const stoppingPoint = deriveStoppingPoint(state, frontier);

  const phases = plan.phases.map(phase => ({
    id: phase.id,
    title: phase.title,
    editable: frontier.phaseBriefEditable.get(phase.index) ?? false,
    frozenReason: frontier.phaseFrozenReason.get(phase.index) ?? null,
    tasks: phase.tasks.map(task => ({
      id: task.id,
      title: task.title,
      repo: task.targetRepos[0] ?? '',
      editable: frontier.taskEditable.get(task.id) ?? false,
      frozenReason: frontier.taskFrozenReason.get(task.id) ?? null,
    })),
  }));

  return { applied, next, sealed, firstEditablePhase, stoppingPoint, phases };
}

const HALTED_STATUS = 'halted';
const NOT_STARTED_STATUS = 'not_started';
const IN_PROGRESS_STATUS = 'in_progress';
const COMPLETED_STATUS = 'completed';
const SKIPPED_STATUS = 'skipped';

const DEFAULT_HALT_REASON = 'no halt reason recorded';

/** A gate node the walker has armed for a human decision: blocking, not merely pending. */
function isGateArmed(node: AmendableNode | undefined): boolean {
  return node !== undefined && node.status === IN_PROGRESS_STATUS && node.gate_active === true;
}

/**
 * Where a halt sits: the halted top-level node when one exists (a rejection halt
 * puts `final_review` itself at `halted`); else `frontier.upstreamHalt.node`, the
 * only thing that walks into `phase_loop`'s iterations; else `phase_loop`, for the
 * shape a mid-plan halt leaves — the container `in_progress` with the halted task
 * buried inside it.
 */
function resolveHaltedNode(state: AmendableState, frontier: Frontier): string {
  for (const id of TOP_LEVEL_NODE_ORDER) {
    if (state.graph.nodes[id]?.status === HALTED_STATUS) return id;
  }
  if (frontier.upstreamHalt !== null) return frontier.upstreamHalt.node;
  return 'phase_loop';
}

/**
 * Derive the pipeline's stopping point from the top-level entries of
 * `state.graph.nodes`, first match wins. `graph.status === 'halted'` is checked
 * first and is the sole halt test — `frontier.upstreamHalt` never walks into the
 * final review step, so testing it alone would miss the common rejection-halt
 * shape and fall through to a confident wrong answer. Every other rule reads a
 * node that may be absent from an older snapshot; absence is tolerated as
 * "not reached this point" or "skipped", never as an error.
 */
function deriveStoppingPoint(state: AmendableState, frontier: Frontier): StoppingPoint {
  const nodes = state.graph.nodes;

  if (state.graph.status === HALTED_STATUS) {
    const node = resolveHaltedNode(state, frontier);
    const reason = state.pipeline?.halt_reason ?? DEFAULT_HALT_REASON;
    return { at: 'halted', node, detail: `The pipeline halted: ${reason}` };
  }

  if (isGateArmed(nodes['plan_approval_gate'])) {
    return {
      at: 'awaiting_plan_approval',
      node: 'plan_approval_gate',
      detail: 'The project is parked at the plan approval gate, awaiting operator approval.',
    };
  }

  const phaseLoop = nodes['phase_loop'];
  if (phaseLoop === undefined || phaseLoop.status === NOT_STARTED_STATUS) {
    return { at: 'phase_loop_not_started', node: 'phase_loop', detail: 'The phase loop has not started yet.' };
  }
  if (phaseLoop.status === IN_PROGRESS_STATUS) {
    return { at: 'phase_loop_in_progress', node: 'phase_loop', detail: 'The phase loop is running.' };
  }

  const finalReview = nodes['final_review'];
  if (finalReview === undefined || finalReview.status === NOT_STARTED_STATUS) {
    return {
      at: 'awaiting_final_review',
      node: 'final_review',
      detail: 'All phases are finished; the project is awaiting final review.',
    };
  }
  if (finalReview.status === IN_PROGRESS_STATUS) {
    return {
      at: 'final_review_in_progress',
      node: 'final_review',
      detail: 'Final review, or a corrective against it, is running.',
    };
  }

  const prGate = nodes['pr_gate'];
  if (prGate !== undefined && prGate.status !== COMPLETED_STATUS && prGate.status !== SKIPPED_STATUS) {
    return { at: 'pr_gate', node: 'pr_gate', detail: 'The PR gate is still resolving.' };
  }

  if (isGateArmed(nodes['final_approval_gate'])) {
    return {
      at: 'final_approval_gate',
      node: 'final_approval_gate',
      detail: 'The project is parked at the final approval gate, awaiting operator approval.',
    };
  }

  return { at: 'unknown', node: null, detail: "The pipeline's stopping point could not be determined." };
}

/** Mirrors `validate.ts`'s own resolution, so every amendment verb agrees on where the Master Plan lives. */
function resolveMasterPlanPath(projectDir: string, state: AmendableState): string | null {
  const docPath = state.graph?.nodes?.['master_plan']?.doc_path;
  if (typeof docPath !== 'string' || docPath.length === 0) return null;
  return path.isAbsolute(docPath) ? docPath : path.join(projectDir, docPath);
}

/** Mirrors `lib/amendment/apply.ts`'s `resolveRequirementsPath`. */
function resolveRequirementsPath(projectDir: string, projectName: string, state: AmendableState): string {
  const docPath = state.graph?.nodes?.['requirements']?.doc_path;
  if (typeof docPath === 'string' && docPath.length > 0) {
    return path.isAbsolute(docPath) ? docPath : path.join(projectDir, docPath);
  }
  return path.join(projectDir, `${projectName}-REQUIREMENTS.md`);
}

/** Mirrors `lib/amendment/apply.ts`'s `resolveProjectName`. */
function resolveProjectName(projectDir: string, state: AmendableState): string {
  const name = state.project?.['name'];
  return typeof name === 'string' && name.length > 0 ? name : path.basename(projectDir);
}

/**
 * The Requirements doc's sealed `template` and `task-size` frontmatter keys, both
 * `null` when the document or either key is absent — a missing seal is an
 * answer, not a fault, since this is a read verb with no amendment document to
 * check it against.
 */
function readSealedRequirements(requirementsPath: string): { template: string | null; taskSize: string | null } {
  let raw: string;
  try {
    raw = fs.readFileSync(requirementsPath, 'utf-8');
  } catch {
    return { template: null, taskSize: null };
  }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (match === null) return { template: null, taskSize: null };
  const frontmatter = parseYaml<Record<string, unknown>>(match[1] ?? '') ?? {};
  const template = typeof frontmatter['template'] === 'string' ? frontmatter['template'] : null;
  const taskSize = typeof frontmatter['task-size'] === 'string' ? frontmatter['task-size'] : null;
  return { template, taskSize };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

interface Args { 'project-dir'?: string }

export const amendmentStatusCommand = defineCommand({
  name: 'amendment-status',
  description: 'Report what an amendment may legally do to this project right now',
  args: {
    'project-dir': {
      description: 'Absolute path to the project directory holding state.json',
      required: true,
    },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    const projectDir = args['project-dir'];
    if (!projectDir) throw new UserError('--project-dir is required');
    return amendmentStatus({ projectDir });
  },
});
