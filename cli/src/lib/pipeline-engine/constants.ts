import type { NodeKind, NodeStatus, GraphStatus, ConditionOperator } from './types.js';

// ── Node Kinds ────────────────────────────────────────────────────────────────
export const NODE_KINDS = Object.freeze({
  STEP: 'step',
  GATE: 'gate',
  FOR_EACH_PHASE: 'for_each_phase',
  FOR_EACH_TASK: 'for_each_task',
  CONDITIONAL: 'conditional',
  PARALLEL: 'parallel',
} as const) satisfies Record<string, NodeKind>;

// ── Node Statuses ─────────────────────────────────────────────────────────────
export const NODE_STATUSES = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  HALTED: 'halted',
  SKIPPED: 'skipped',
} as const) satisfies Record<string, NodeStatus>;

// ── Graph Statuses ────────────────────────────────────────────────────────────
export const GRAPH_STATUSES = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  HALTED: 'halted',
} as const) satisfies Record<string, GraphStatus>;

// ── Condition Operators ───────────────────────────────────────────────────────
export const CONDITION_OPERATORS = Object.freeze({
  EQ: 'eq',
  NEQ: 'neq',
  IN: 'in',
  NOT_IN: 'not_in',
  TRUTHY: 'truthy',
  FALSY: 'falsy',
} as const) satisfies Record<string, ConditionOperator>;

// ── Next Actions ──────────────────────────────────────────────────────────────
export const NEXT_ACTIONS = Object.freeze({
  // Planning agent spawns
  SPAWN_MASTER_PLAN: 'spawn_master_plan',

  // Planning scripts
  EXPLODE_MASTER_PLAN: 'explode_master_plan',

  // Human gates
  REQUEST_PLAN_APPROVAL: 'request_plan_approval',
  GATE_TASK: 'gate_task',
  GATE_PHASE: 'gate_phase',
  ASK_GATE_MODE: 'ask_gate_mode',
  REQUEST_FINAL_APPROVAL: 'request_final_approval',

  // Execution agent spawns
  EXECUTE_TASK: 'execute_task',
  SPAWN_CODE_REVIEWER: 'spawn_code_reviewer',
  SPAWN_PHASE_REVIEWER: 'spawn_phase_reviewer',
  SPAWN_FINAL_REVIEWER: 'spawn_final_reviewer',

  // Source control
  INVOKE_SOURCE_CONTROL_PR: 'invoke_source_control_pr',

  // Terminal states
  DISPLAY_HALTED: 'display_halted',
  DISPLAY_COMPLETE: 'display_complete',
} as const);

// ── Events ────────────────────────────────────────────────────────────────────
// Per FR-11, no `*_started` events are accepted by the engine. Step-node
// transitions to `in_progress` happen via the optimistic write in `processEvent`
// (FR-10) on the same writeState as the next-action emit. `pr_requested` is
// the historical "started" event of `final_pr`; its identifier is preserved
// because it does not match the `_started` suffix.
export const EVENTS = Object.freeze({
  // ── Planning step events ──────────────────────────────────────────────
  MASTER_PLAN_COMPLETED: 'master_plan_completed',
  EXPLOSION_COMPLETED: 'explosion_completed',
  EXPLOSION_FAILED: 'explosion_failed',

  // ── Gate approved events ──────────────────────────────────────────────
  PLAN_APPROVED: 'plan_approved',
  TASK_GATE_APPROVED: 'task_gate_approved',
  PHASE_GATE_APPROVED: 'phase_gate_approved',
  FINAL_APPROVED: 'final_approved',

  // ── Task execution events ─────────────────────────────────────────────
  TASK_COMPLETED: 'task_completed',
  CODE_REVIEW_COMPLETED: 'code_review_completed',

  // ── Phase review events ───────────────────────────────────────────────
  PHASE_REVIEW_COMPLETED: 'phase_review_completed',

  // ── Final review events ───────────────────────────────────────────────
  FINAL_REVIEW_COMPLETED: 'final_review_completed',

  // ── Source control events ─────────────────────────────────────────────
  PR_REQUESTED: 'pr_requested',
  PR_CREATED: 'pr_created',

  // ── Out-of-band events ────────────────────────────────────────────────
  PLAN_REJECTED: 'plan_rejected',
  GATE_REJECTED: 'gate_rejected',
  FINAL_REJECTED: 'final_rejected',
  HALT: 'halt',
  GATE_MODE_SET: 'gate_mode_set',
} as const);

export const OUT_OF_BAND_EVENTS = new Set<string>([
  'plan_rejected',
  'gate_rejected',
  'final_rejected',
  'halt',
  'gate_mode_set',
  // Parse-failure recovery loop: step-level `failed` events are not template-indexed
  // by buildEventIndex, so routing `explosion_failed` requires the out-of-band path.
  'explosion_failed',
]);

export const REVIEW_VERDICTS = Object.freeze({
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REJECTED: 'rejected',
} as const);

export const VALID_VERDICTS = new Set<string>(Object.values(REVIEW_VERDICTS));

export const ALLOWED_NODE_TRANSITIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['not_started', new Set(['in_progress', 'skipped', 'completed'])],
  // 'not_started' here: a rejection mutation (plan_rejected, final_rejected)
  // resets a blocking human approval gate that is currently in_progress back
  // to not_started.
  ['in_progress', new Set(['completed', 'failed', 'halted', 'not_started'])],
  ['completed',   new Set(['not_started', 'in_progress'])],
  ['failed',      new Set(['in_progress'])],
  ['halted',      new Set([])],
  ['skipped',     new Set([])],
]);
