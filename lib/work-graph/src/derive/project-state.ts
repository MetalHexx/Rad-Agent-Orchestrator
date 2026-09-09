import type { Tier } from '../types.js';

/**
 * The closed vocabulary for "what state is this project in?".
 *
 * Distinct from `NodeStatus` (a rollup of individual work items) and from `Tier`
 * (which pipeline tier is active). Every surface renders this value.
 */
export type ProjectState =
  | 'not_initialized' | 'not_started' | 'planning' | 'planned'
  | 'executing' | 'pending_review' | 'halted' | 'complete';

/** Declaration order is the group-rollup priority order — see combineProjectStates. */
export const PROJECT_STATES: readonly ProjectState[] = [
  'halted', 'executing', 'planning', 'pending_review', 'planned',
  'not_started', 'not_initialized', 'complete',
];

export const PROJECT_STATE_LABELS: Record<ProjectState, string> = {
  not_initialized: 'Not Initialized',
  not_started: 'Not Started',
  planning: 'Planning',
  planned: 'Planned',
  executing: 'Executing',
  pending_review: 'Pending Review',
  halted: 'Halted',
  complete: 'Complete',
};

export interface DerivedProjectState {
  /** The sanitized active tier, or 'complete' when structurally finished. Diagnostic
   *  detail and the canvas accent key — never the answer to "what state is this in". */
  tier: Tier | null;
  state: ProjectState;
  /** Always `PROJECT_STATE_LABELS[state]`. */
  label: string;
}

/**
 * Planning steps a project may scaffold. A tier template need not carry them all,
 * so a step absent from `graph.nodes` must not block planning completion.
 */
const PLANNING_STEPS = [
  'research', 'prd', 'design', 'architecture', 'requirements', 'master_plan', 'explode_master_plan',
] as const;

/**
 * The only `current_tier` values the current schema permits. Every other value —
 * including the legacy `'complete'` written by an earlier engine — is treated as
 * absent, so a legacy file and a current-engine file resolve identically.
 */
const ACTIVE_TIERS: readonly Tier[] = ['planning', 'execution', 'review', 'halted'];

type RawNodes = Record<string, { status?: unknown } | undefined>;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readGraph(raw: unknown): Record<string, unknown> | null {
  const root = asObject(raw);
  return root ? asObject(root.graph) : null;
}

function readNodes(graph: Record<string, unknown>): RawNodes {
  return (asObject(graph.nodes) ?? {}) as RawNodes;
}

function readTier(raw: unknown): Tier | null {
  const tier = asObject(asObject(raw)?.pipeline)?.current_tier;
  return ACTIVE_TIERS.includes(tier as Tier) ? (tier as Tier) : null;
}

function planningState(graph: Record<string, unknown>): ProjectState {
  const nodes = readNodes(graph);
  const present = PLANNING_STEPS.filter((step) => nodes[step] !== undefined);
  if (present.length === 0) return 'not_started';
  const statuses = present.map((step) => nodes[step]?.status);
  if (statuses.every((s) => s === 'completed')) return 'planned';
  if (statuses.some((s) => s === 'in_progress') || graph.status === 'in_progress') return 'planning';
  return 'not_started';
}

function executionState(graph: Record<string, unknown>): ProjectState {
  const nodes = readNodes(graph);
  const running = (id: string) => nodes[id]?.status === 'in_progress';
  return running('phase_loop') || running('final_review') ? 'executing' : 'pending_review';
}

function derived(state: ProjectState, tier: Tier | null): DerivedProjectState {
  return { tier, state, label: PROJECT_STATE_LABELS[state] };
}

/**
 * Resolve a parsed `state.json` into the one canonical project state and its label.
 *
 * Pure — no filesystem, no network. `raw` is a parsed `state.json`, or null/undefined
 * when the project has no state file at all.
 *
 * Precedence, first match wins: no `graph` object → `not_initialized`; a completed
 * graph → `complete`; a halted graph or halted tier → `halted`; otherwise the planning
 * or execution sub-branch for the active tier. An unusable tier falls back to the
 * structural shape of `graph.nodes`.
 */
export function deriveProjectState(raw: unknown): DerivedProjectState {
  const graph = readGraph(raw);
  if (!graph) return derived('not_initialized', null);

  const tier = readTier(raw);
  if (graph.status === 'completed') return derived('complete', 'complete');
  if (graph.status === 'halted' || tier === 'halted') return derived('halted', tier);
  if (tier === 'planning') return derived(planningState(graph), 'planning');
  if (tier === 'execution' || tier === 'review') return derived(executionState(graph), tier);

  // Reachable only for a malformed or pre-current-engine file that is neither completed
  // nor halted: read the structure instead — planning first, then execution once planning
  // itself is finished.
  const planning = planningState(graph);
  return derived(planning === 'planned' ? executionState(graph) : planning, null);
}

/**
 * Roll member project states into one group state over the same closed vocabulary.
 * The highest-priority state present wins (`PROJECT_STATES` order, with `complete`
 * ranked last so an all-complete group reads as `complete`). No members at all →
 * `not_initialized`.
 */
export function combineProjectStates(states: ProjectState[]): ProjectState {
  if (states.length === 0) return 'not_initialized';
  const present = new Set(states);
  return PROJECT_STATES.find((s) => present.has(s)) ?? 'complete';
}
