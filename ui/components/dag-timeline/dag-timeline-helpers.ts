import type { StepNodeState, GateNodeState, ConditionalNodeState, ParallelNodeState, NodesRecord, NodeState, ForEachPhaseNodeState, GateEvent, NodeStatus, IterationEntry } from '@/types/state';
import { STATUS_MAP } from './node-status-map';

export type CompatibleNodeState = StepNodeState | GateNodeState | ConditionalNodeState | ParallelNodeState;

export interface RowVisibilityContext {
  prUrl: string | null;
  commitHash: string | null;
}

/**
 * Hide rows that add no signal beyond what the project header already
 * surfaces (auto_commit / auto_pr / gate_mode badges). Hiding a gate
 * conditional does not orphan its child action — the executor flattens
 * branch_true children into the parent scope's nodes dict.
 */
export function shouldRenderTimelineRow(
  nodeId: string,
  node: CompatibleNodeState,
  ctx: RowVisibilityContext,
): boolean {
  if (nodeId === 'pr_gate') return false;

  if (node.kind === 'gate' && (nodeId === 'task_gate' || nodeId === 'phase_gate')) {
    if (node.gate_active === false) return false;
  }

  if (nodeId === 'final_pr') return false; // FR-14: PRs surface only in the Source Control panel

  return true;
}

export function deriveRepoBaseUrl(compareUrl: string | null): string | null {
  if (compareUrl == null) return null;
  if (compareUrl.trim().length === 0) return null;
  const idx = compareUrl.indexOf('/compare/');
  if (idx === -1) return null;
  return compareUrl.slice(0, idx);
}

export function getCommitLinkData(
  commitHash: string | null | undefined,
  repoBaseUrl: string | null
): { href: string | null; label: string } | null {
  if (commitHash == null || commitHash.length === 0) return null;
  return {
    href: repoBaseUrl != null ? repoBaseUrl + '/commit/' + commitHash : null,
    label: commitHash.slice(0, 7),
  };
}

export function isLoopNode(node: NodeState): node is Extract<NodeState, { kind: 'for_each_phase' | 'for_each_task' }> {
  return node.kind === 'for_each_phase' || node.kind === 'for_each_task';
}

/**
 * Builds the controlled-mode accordion `value` for a phase / task iteration
 * panel. Same shape consumed by `useFollowMode.computeSmartDefaults` and the
 * iteration panel's `<Accordion value=...>` so the hook and the renderer
 * agree on identity.
 *
 * Encoding: `iter-${parentNodeId}-${iterationIndex}`.
 *
 * `parentNodeId` may itself be a compound id (e.g.
 * `phase_loop.iter0.task_loop`) — the resulting key is unique because no
 * sibling iteration shares the same parent + index pair.
 */
export function buildIterationItemValue(parentNodeId: string, iterationIndex: number): string {
  return `iter-${parentNodeId}-${iterationIndex}`;
}

/**
 * Builds the controlled-mode accordion `value` for a corrective task panel
 * nested under an iteration. The parent key is itself an iteration key
 * produced by `buildIterationItemValue`, so corrective expansion is
 * unambiguously scoped to one iteration.
 *
 * Encoding: `ct-${parentIterationKey}-${ctIndex}`.
 */
export function buildCorrectiveItemValue(parentIterationKey: string, ctIndex: number): string {
  return `ct-${parentIterationKey}-${ctIndex}`;
}

export function filterCompatibleNodes(
  nodes: NodesRecord
): Array<[string, CompatibleNodeState]> {
  return Object.entries(nodes).filter(
    ([, node]) => !isLoopNode(node)
  ) as Array<[string, CompatibleNodeState]>;
}

/**
 * Converts a snake_case node ID to a human-readable display name.
 * "gate_mode_selection" → "Gate Mode Selection"
 */
export function formatNodeId(nodeId: string): string {
  return nodeId
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extracts the leaf segment of a compound node ID — the substring after the
 * last `.`, or the whole string if no `.` is present.
 *
 * "phase_loop.iter0.phase_planning" → "phase_planning"
 * "phase_planning"                  → "phase_planning"
 */
function extractLeaf(nodeId: string): string {
  const lastDot = nodeId.lastIndexOf('.');
  return lastDot === -1 ? nodeId : nodeId.slice(lastDot + 1);
}

/**
 * Extracts the leaf segment from a compound node ID and formats it
 * as a human-readable display name.
 *
 * "phase_loop.iter0.phase_planning" → "Phase Planning"
 * "phase_planning"                  → "Phase Planning"
 */
/**
 * Acronym overrides for `getDisplayName`. `formatNodeId` does naive
 * title-casing (`final_pr` → `Final Pr`); these entries restore the
 * intended capitalization for known acronyms surfaced as row titles.
 */
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  final_pr: 'Final PR',
  pr_gate: 'PR Gate',
};

export function getDisplayName(nodeId: string): string {
  const leaf = extractLeaf(nodeId);
  return DISPLAY_NAME_OVERRIDES[leaf] ?? formatNodeId(leaf);
}

// ─── Gate Node Config (single source of truth for approval buttons) ──────────

/**
 * Maps gate node leaf IDs to their corresponding gate event and button label.
 * Only plan-approval and final-approval gates receive approval buttons.
 * `pr_gate`, `gate_mode_selection`, `task_gate`, and `phase_gate` are
 * intentionally absent.
 */
export const GATE_NODE_CONFIG: Record<string, {
  event: GateEvent;
  label: string;
}> = {
  plan_approval_gate: { event: 'plan_approved', label: 'Approve Plan' },
  final_approval_gate: { event: 'final_approved', label: 'Approve Final Review' },
};

/**
 * Resolves a node ID (possibly compound, like `phase_loop.iter0.task_gate`)
 * against `GATE_NODE_CONFIG` by extracting its leaf segment (substring after
 * the last `.`, or the whole string if no `.`). Returns the config or `null`.
 */
export function getGateNodeConfig(
  nodeId: string
): { event: GateEvent; label: string } | null {
  return GATE_NODE_CONFIG[extractLeaf(nodeId)] ?? null;
}

// ─── Row Button Descriptor (FR-1, FR-2, FR-3, AD-1, AD-2) ────────────────────

/**
 * Descriptor returned by `getRowButtonDescriptor` describing which (if any)
 * action button renders on a given DAG row. The discriminated union keeps
 * the FR-3 mutex invariant computable in one place — the row component
 * branches on `kind` rather than re-deriving predicates inline.
 *
 *  - `'none'`    — no button on this row right now
 *  - `'approve'` — render ApproveGateButton with the given event/label (FR-1)
 *  - `'execute'` — render ExecutePlanButton with the given label (FR-2)
 */
export type RowButtonDescriptor =
  | { kind: 'none' }
  | { kind: 'approve'; event: GateEvent; label: string }
  | { kind: 'execute'; label: string };

/**
 * Single source of truth for which button (if any) renders on a DAG row.
 *
 * Inputs:
 *   - nodeId           — possibly compound (`phase_loop.iter0.plan_approval_gate`)
 *   - node             — the resolved gate node (only used for plan/final approval gates)
 *   - phaseLoopStatus  — top-level `state.graph.nodes.phase_loop.status` (AD-2)
 *
 * Decision table (FR-3 mutex):
 *   plan_approval_gate, gate_active=true                            → approve (FR-1)
 *   plan_approval_gate, status=completed, phase_loop=not_started    → execute (FR-2)
 *   final_approval_gate, gate_active=true                           → approve (FR-1)
 *   anything else                                                   → none
 */
export function getRowButtonDescriptor(
  nodeId: string,
  node: GateNodeState,
  phaseLoopStatus: NodeStatus | undefined
): RowButtonDescriptor {
  const cfg = getGateNodeConfig(nodeId);
  if (cfg === null) return { kind: 'none' };

  // FR-1: Approve button is bound to gate_active, not status alone.
  if (node.gate_active === true && node.status !== 'completed') {
    return { kind: 'approve', event: cfg.event, label: cfg.label };
  }

  // FR-2: Execute Plan only on the plan-approval row, only when the gate
  // has been approved (status completed) AND the phase_loop has not yet
  // begun. The final-approval row never yields 'execute'.
  const leaf = extractLeaf(nodeId);
  if (
    leaf === 'plan_approval_gate' &&
    node.status === 'completed' &&
    phaseLoopStatus === 'not_started'
  ) {
    return { kind: 'execute', label: 'Execute Plan' };
  }

  return { kind: 'none' };
}

// ─── Section Types ────────────────────────────────────────────────────────────

export type SectionLabel = 'Planning' | 'Execution' | 'Completion';

export interface SectionGroup {
  label: SectionLabel;
  entries: Array<[string, NodeState]>;
}

// ─── Section Constants ────────────────────────────────────────────────────────

export const NODE_SECTION_MAP: Record<string, SectionLabel> = {
  prd: 'Planning',
  research: 'Planning',
  design: 'Planning',
  architecture: 'Planning',
  requirements: 'Planning',
  master_plan: 'Planning',
  explode_master_plan: 'Planning',
  plan_approval_gate: 'Planning',
  gate_mode_selection: 'Planning',
  phase_loop: 'Execution',
  final_review: 'Completion',
  pr_gate: 'Completion',
  final_approval_gate: 'Completion',
  final_pr: 'Completion',
};

// ─── Doc-link label table (AD-6) ────────────────────────────────────────────

// Two buckets: artifact docs → 'Document', review/report outputs → 'Report'.
// Rolls back FR-11's strict per-node typing — that contract read as
// duplicative on screen since the flat-row title already names the document
// (e.g. ✓ Requirements ░Requirements). Iteration trigger labels (Phase Plan /
// Task Handoff / Handoff / Pull Request) are hard-coded at the call site
// and remain typed because they don't duplicate the trigger title.
const DOC_LINK_LABELS: Record<string, string> = {
  research:        'Document',
  prd:             'Document',
  design:          'Document',
  architecture:    'Document',
  requirements:    'Document',
  master_plan:     'Document',
  code_review:     'Report',
  phase_report:    'Report',
  phase_review:    'Report',
  final_review:    'Report',
};

/**
 * Returns the bucketed doc-link label for a node id. Resolves compound ids
 * (`phase_loop.iter0.task_loop.iter1.code_review`) by extracting the leaf
 * segment (AD-6 — same `extractLeaf` pattern used by `getDisplayName` and
 * `getGateNodeConfig`). Falls back to `getDisplayName(nodeId)` for ids
 * not in `DOC_LINK_LABELS`.
 */
export function getDocLinkLabel(nodeId: string): string {
  const leaf = extractLeaf(nodeId);
  return DOC_LINK_LABELS[leaf] ?? getDisplayName(nodeId);
}

// ─── Top-level planning step ids (used by resolveStageBadge) ─────────────────
// Top-level planning leaves keep the blue --tier-planning + "Planning"
// treatment under FR-12. phase_planning is intentionally excluded —
// FR-11 / FR-17 retired its planning treatment in favor of "Executing"
// at the phase iteration scope.
const PLANNING_STEP_IDS: ReadonlySet<string> = new Set([
  'research',
  'prd',
  'design',
  'architecture',
  'requirements',
  'master_plan',
  'explode_master_plan',
]);

// ─── Section Helper Functions ─────────────────────────────────────────────────

export function parsePhaseNameFromDocPath(
  docPath: string | null,
  iterationIndex: number
): string {
  const phaseNum = iterationIndex + 1;
  if (!docPath) return `Phase ${phaseNum}`;

  // Match pattern: {anything}-PHASE-{NN}-{TITLE}.md
  const match = docPath.match(/-PHASE-\d+-(.+)\.md$/i);
  if (!match) return `Phase ${phaseNum}`;

  const title = match[1]
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return `Phase ${phaseNum} — ${title}`;
}

export function parseTaskNameFromDocPath(
  docPath: string | null,
  iterationIndex: number
): string {
  const taskNum = iterationIndex + 1;
  if (!docPath) return `Task ${taskNum}`;

  // Match pattern: {anything}-TASK-P{NN}-T{NN}-{TITLE}.md
  const match = docPath.match(/-TASK-P\d+-T\d+-(.+)\.md$/i);
  if (!match) return `Task ${taskNum}`;

  const title = match[1]
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return `Task ${taskNum} — ${title}`;
}

export function groupNodesBySection(nodes: NodesRecord): SectionGroup[] {
  const sectionOrder: SectionLabel[] = ['Planning', 'Execution', 'Completion'];
  const buckets = new Map<SectionLabel, Array<[string, NodeState]>>();

  for (const label of sectionOrder) {
    buckets.set(label, []);
  }

  for (const [nodeId, nodeState] of Object.entries(nodes)) {
    if (!Object.hasOwn(NODE_SECTION_MAP, nodeId)) {
      continue;
    }
    const label = NODE_SECTION_MAP[nodeId];
    buckets.get(label)!.push([nodeId, nodeState]);
  }

  const groups: SectionGroup[] = [];
  for (const label of sectionOrder) {
    const entries = buckets.get(label)!;
    if (entries.length > 0) {
      groups.push({ label, entries });
    }
  }

  return groups;
}

export function deriveCurrentPhase(
  phaseLoopNode: ForEachPhaseNodeState | undefined
): string | null {
  if (!phaseLoopNode) return null;

  const activeIteration = phaseLoopNode.iterations.find(
    (iter) => iter.status === 'in_progress'
  );
  if (!activeIteration) return null;

  const phasePlanningNode = activeIteration.nodes.phase_planning;
  const legacyDocPath = phasePlanningNode?.kind === 'step' ? phasePlanningNode.doc_path : null;
  const docPath = activeIteration.doc_path ?? legacyDocPath ?? null;

  return parsePhaseNameFromDocPath(docPath, activeIteration.index);
}

export function derivePhaseProgress(
  phaseLoopNode: ForEachPhaseNodeState | undefined
): { completed: number; total: number } | null {
  if (!phaseLoopNode || phaseLoopNode.iterations.length === 0) return null;

  const completed = phaseLoopNode.iterations.filter(
    (iter) => iter.status === 'completed'
  ).length;

  return { completed, total: phaseLoopNode.iterations.length };
}

/**
 * Derives `{ completed, total }` for a phase iteration's progress bar
 * (FR-7, AD-4). Reads the iteration's own embedded `task_loop` node so
 * the bar is scoped to that single phase iteration — not the top-level
 * `phase_loop`. Returns `null` when the iteration has no `task_loop`
 * child (e.g. legacy or pre-explosion shape); returns `{ 0, 0 }` when
 * `task_loop.iterations.length === 0` so the FR-8 empty-track render
 * path can still draw the bar at 0%. Counts only iterations whose
 * status is exactly `'completed'`, which keeps the bar full after the
 * phase iteration itself moves to `completed`.
 */
export function deriveIterationTaskProgress(
  iteration: IterationEntry
): { completed: number; total: number } | null {
  const taskLoopNode = iteration.nodes['task_loop'];
  if (!taskLoopNode || taskLoopNode.kind !== 'for_each_task') return null;
  const completed = taskLoopNode.iterations.filter(
    (i) => i.status === 'completed'
  ).length;
  return { completed, total: taskLoopNode.iterations.length };
}

// ─── Stage-aware label derivation (FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, AD-1, AD-2, AD-4, AD-6, DD-1, DD-2) ──

/**
 * Substep node-id → in-progress {cssVar, label} table. Single source of
 * truth for stage-aware badge resolution at iteration headers AND
 * substep rows. `final_review` joins the reviewing-stage family
 * (FR-4) so the top-level Completion-section row gets the same
 * purple "Reviewing" treatment as `phase_review` / `code_review`.
 */
const ITERATION_SUBSTEP_CONFIG: Record<string, { cssVar: string; label: string }> = {
  task_executor: { cssVar: '--tier-execution', label: 'Coding'     },
  code_review:   { cssVar: '--tier-review',    label: 'Reviewing'  },
  phase_review:  { cssVar: '--tier-review',    label: 'Reviewing'  },
  final_review:  { cssVar: '--tier-review',    label: 'Reviewing'  },
};

/**
 * Public label-only projection of `ITERATION_SUBSTEP_CONFIG`.
 * Preserved for back-compat with existing iteration-panel
 * imports and tests.
 */
export const ITERATION_SUBSTEP_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(ITERATION_SUBSTEP_CONFIG).map(([k, v]) => [k, v.label])
);

/**
 * Resolves a `(nodeId, status)` pair to the badge's `{cssVar, label}`
 * (FR-1, FR-2, FR-4, FR-6, AD-2, AD-4, DD-1, DD-2). Single source of
 * truth for stage-aware badge resolution at iteration headers AND
 * substep rows.
 *
 * Resolution order for `in_progress`:
 *   1. Planning leaf id (research/prd/design/architecture/requirements/
 *      master_plan/explode_master_plan)         → --tier-planning + "Planning"
 *   2. Substep leaf id in ITERATION_SUBSTEP_CONFIG → entry's cssVar + label
 *   3. Fallback                                    → STATUS_MAP['in_progress']
 *
 * For non-`in_progress` statuses, returns `STATUS_MAP[status]` defaults
 * (DD-2 — no overrides for "Not Started", "Completed", "Skipped",
 * "Failed", "Halted").
 */
export function resolveStageBadge(
  nodeId: string,
  status: NodeStatus,
): { cssVar: string; label: string } {
  if (status !== 'in_progress') {
    const entry = STATUS_MAP[status];
    return { cssVar: entry.cssVar, label: entry.defaultLabel };
  }
  const leaf = extractLeaf(nodeId);
  if (PLANNING_STEP_IDS.has(leaf)) {
    return { cssVar: '--tier-planning', label: 'Planning' };
  }
  const cfg = ITERATION_SUBSTEP_CONFIG[leaf];
  if (cfg !== undefined) {
    return { cssVar: cfg.cssVar, label: cfg.label };
  }
  const entry = STATUS_MAP['in_progress'];
  return { cssVar: entry.cssVar, label: entry.defaultLabel };
}

/**
 * Derives the resolved {status, label} pair for an iteration's badge.
 *
 * - parentKind === 'for_each_phase': stops at the phase's own direct
 *   substeps (FR-3 / AD-3 / DD-7). Never recurses into an active
 *   task's substeps. A phase whose `task_loop` is in_progress reads
 *   "Executing" regardless of which task substep is currently active.
 * - parentKind === 'for_each_task': preserves the original substep
 *   walk so task-iteration rows continue to surface their own
 *   substep label (e.g. "Reviewing" while a code_review is in flight).
 *
 * For non-in_progress statuses, returns STATUS_MAP defaults
 * regardless of parentKind (DD-2).
 */
export function deriveIterationBadgeLabel(
  iteration: IterationEntry,
  parentKind: 'for_each_phase' | 'for_each_task',
): { status: NodeStatus; label: string } {
  // FR-6 / DD-4 — terminal failure reads "Failed" (X glyph supplied by
  // STATUS_MAP['failed'].isRejected); halted iterations read STATUS_MAP['halted']
  // .defaultLabel ("Halted"). Neither branch carries a spinner.
  if (iteration.status === 'failed') {
    return { status: 'failed', label: 'Failed' };
  }
  if (iteration.status === 'halted') {
    const entry = STATUS_MAP['halted'];
    return { status: 'halted', label: entry.defaultLabel };
  }
  if (iteration.status !== 'in_progress') {
    const entry = STATUS_MAP[iteration.status];
    return { status: iteration.status, label: entry.defaultLabel };
  }

  // FR-4 / DD-3 — when any corrective entry is in flight under a task
  // iteration, the task parent's badge reads "Correcting" (red + spinner).
  // This applies only to `for_each_task`; phase iterations do not use
  // `corrective_tasks` here.
  if (parentKind === 'for_each_task' &&
      iteration.corrective_tasks.some((ct) => ct.status === 'in_progress')) {
    return { status: 'in_progress', label: 'Correcting' };
  }

  // FR-3 / FR-11 / AD-1 / FR-17 — phase iteration stops at its own substeps.
  // Look only at the phase's direct children (phase_planning / task_loop
  // / phase_review). When task_loop OR phase_planning is the in-flight
  // child, the phase row reads "Executing" — there is no separate
  // "Planning" branch (FR-11), and `phase_planning` is intentionally
  // unified with `task_loop` here so an in-flight planning child still
  // surfaces "Executing" on the phase row (FR-17).
  if (parentKind === 'for_each_phase') {
    for (const [childId, childNode] of Object.entries(iteration.nodes)) {
      if (childNode.status !== 'in_progress') continue;
      if (childId === 'task_loop' || childId === 'phase_planning') {
        return { status: 'in_progress', label: 'Executing' };
      }
      const cfg = ITERATION_SUBSTEP_CONFIG[childId];
      if (cfg !== undefined) {
        return { status: 'in_progress', label: cfg.label };
      }
    }
    return { status: 'in_progress', label: 'Executing' };
  }

  // parentKind === 'for_each_task' — preserve the substep walk so the
  // task iteration row surfaces its own substep label. task_executor
  // now resolves to 'Coding' via ITERATION_SUBSTEP_LABELS (FR-2, DD-1).
  for (const [childId, childNode] of Object.entries(iteration.nodes)) {
    if (childNode.status !== 'in_progress') continue;
    const label = ITERATION_SUBSTEP_LABELS[childId];
    if (label !== undefined) {
      return { status: 'in_progress', label };
    }
  }
  return { status: 'in_progress', label: 'Coding' };
}

/**
 * Resolves the badge {status, label} for a gate node. When
 * `gate_active === true` (FR-4), forces the gray `not_started` visual
 * with label `'Not Started'` (DD-3). Otherwise returns the gate's own
 * status with its STATUS_MAP defaultLabel.
 */
export function deriveGateBadgeStatusAndLabel(
  node: GateNodeState
): { status: NodeStatus; label: string } {
  if (node.gate_active === true && node.status !== 'completed') {
    return { status: 'not_started', label: 'Not Started' };
  }
  const entry = STATUS_MAP[node.status];
  return { status: node.status, label: entry.defaultLabel };
}
