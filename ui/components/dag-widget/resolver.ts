import type {
  AnyProjectState,
  NodeState,
  NodesRecord,
  IterationEntry,
  CorrectiveTaskEntry,
  ForEachPhaseNodeState,
} from '@/types/state';
import { deriveCurrentPhase, derivePhaseProgress } from '@/components/dag-timeline/dag-timeline-helpers';
import type { StateId, StateView, StateViewContext } from './types';
import { fallbackView } from './states/fallback-view';
import { planningView } from './states/planning-view';
import { planApprovalView } from './states/plan-approval-view';
import { codingView } from './states/coding-view';
import { reviewingView } from './states/reviewing-view';
import { correctiveView } from './states/corrective-view';
import { phaseReviewView } from './states/phase-review-view';
import { finalReviewView } from './states/final-review-view';
import { completeView } from './states/complete-view';

/**
 * Leaf node id → `StateId`. Only nodes that name a first-class card state are
 * listed; everything else (unknown ids, the skip-set below) falls to
 * `fallback`. Corrective is NOT here — it is identified by a `.ct{N}.` segment
 * in the path, not by the leaf id (a corrective leaf is often `task_executor`
 * or `code_review`, which would otherwise mis-map).
 */
const NODE_ID_TO_STATE: Record<string, StateId> = {
  master_plan: 'planning',
  plan_approval_gate: 'plan-approval',
  task_executor: 'coding',
  code_review: 'reviewing',
  phase_review: 'phase-review',
  final_review: 'final-review',
};

/**
 * Node ids that are never a card state. They resolve to `fallback` (or, in
 * later tasks, are resolved past to the active leaf). Kept explicit so an id
 * accidentally added to `NODE_ID_TO_STATE` that also belongs here is easy to
 * spot, and so the intent (loop containers, auto gates, PR nodes, the two
 * planning-plumbing steps) is documented at the resolver.
 */
const SKIP_STATE_NODE_IDS: ReadonlySet<string> = new Set([
  'explode_master_plan',
  'gate_mode_selection',
  'phase_loop',
  'task_loop',
  'phase_gate',
  'task_gate',
  'final_approval_gate',
  'pr_gate',
  'final_pr',
]);

const ITER_SEGMENT = /^iter(\d+)$/;
const CT_SEGMENT = /^ct(\d+)$/;

interface PathWalkResult {
  node: NodeState | undefined;
  leaf: string;
  isCorrective: boolean;
  iteration: IterationEntry | undefined;
  correctiveEntry: CorrectiveTaskEntry | undefined;
}

/**
 * Descends a dotted node path (`phase_loop.iter0.task_loop.iter1.ct2.code_review`)
 * against the graph's node tree, returning the resolved leaf node plus the
 * innermost iteration / corrective entries walked through.
 *
 * Segment grammar:
 *  - `iter{N}` — select the current `for_each_*` node's iteration whose
 *    `index === N`; its `nodes` become the active record.
 *  - `ct{N}`   — select the enclosing entry's corrective task whose
 *    `index === N` (1-based, matching `CorrectiveTaskEntry.index`); its `nodes`
 *    become the active record. Sets `isCorrective` — this is the ONLY signal
 *    that identifies the corrective state, so a walk that skips it silently
 *    drops corrective to the fallback.
 *  - anything else — a node key looked up in the active record.
 *
 * A malformed / stale path returns `node: undefined`; `isCorrective` still
 * reflects any `ct{N}` segment seen so a partially-walked corrective path is
 * not misclassified.
 */
function walkPath(rootNodes: NodesRecord, path: string): PathWalkResult {
  const segments = path.split('.');
  const leaf = segments[segments.length - 1];

  let currentNodes: NodesRecord | undefined = rootNodes;
  let currentNode: NodeState | undefined;
  let iteration: IterationEntry | undefined;
  let correctiveEntry: CorrectiveTaskEntry | undefined;
  let isCorrective = false;

  for (const segment of segments) {
    const iterMatch = ITER_SEGMENT.exec(segment);
    const ctMatch = CT_SEGMENT.exec(segment);

    if (iterMatch) {
      if (!currentNode || (currentNode.kind !== 'for_each_phase' && currentNode.kind !== 'for_each_task')) {
        return { node: undefined, leaf, isCorrective, iteration, correctiveEntry };
      }
      const index = Number(iterMatch[1]);
      const entry = currentNode.iterations.find((it) => it.index === index);
      if (!entry) {
        return { node: undefined, leaf, isCorrective, iteration, correctiveEntry };
      }
      iteration = entry;
      currentNodes = entry.nodes;
      currentNode = undefined;
      continue;
    }

    if (ctMatch) {
      isCorrective = true;
      const container = correctiveEntry ?? iteration;
      if (!container) {
        return { node: undefined, leaf, isCorrective, iteration, correctiveEntry };
      }
      const index = Number(ctMatch[1]);
      // A nested corrective's `corrective_tasks` is carried at runtime but not
      // typed on `CorrectiveTaskEntry` (only `IterationEntry` declares it), so
      // read it defensively — the same access the timeline's corrective group uses.
      const correctiveTasks: CorrectiveTaskEntry[] =
        (container as { corrective_tasks?: CorrectiveTaskEntry[] }).corrective_tasks ?? [];
      const entry = correctiveTasks.find((ct) => ct.index === index);
      if (!entry) {
        return { node: undefined, leaf, isCorrective, iteration, correctiveEntry };
      }
      correctiveEntry = entry;
      currentNodes = entry.nodes;
      currentNode = undefined;
      continue;
    }

    if (!currentNodes) {
      return { node: undefined, leaf, isCorrective, iteration, correctiveEntry };
    }
    currentNode = currentNodes[segment];
    // A parallel node nests a further record; descend so a following plain
    // segment resolves. for_each_* children are reached via the next iter
    // segment instead, so leave `currentNodes` alone for them.
    currentNodes = currentNode && currentNode.kind === 'parallel' ? currentNode.nodes : undefined;
  }

  return { node: currentNode, leaf, isCorrective, iteration, correctiveEntry };
}

function normalizeFocus(focus: string | undefined, currentNodePath: string | null): string | null {
  const raw = focus ?? currentNodePath;
  if (raw == null || raw.length === 0) return null;
  return raw;
}

/**
 * Maps the active node — identified from the leaf of `focus ?? current_node_path`
 * — to a `StateId`. Resolution order:
 *  1. A completed graph is `complete` regardless of node.
 *  2. A `.ct{N}.` path is `corrective` (wins over the leaf's own mapping).
 *  3. Skip-set leaves and unknown/unresolvable nodes are `fallback`.
 *  4. A mapped leaf id yields its state.
 */
export function resolveStateId(state: AnyProjectState, focus?: string): StateId {
  if (state.graph.status === 'completed') return 'complete';

  const path = normalizeFocus(focus, state.graph.current_node_path);
  if (path == null) return 'fallback';

  const { node, leaf, isCorrective } = walkPath(state.graph.nodes, path);
  if (isCorrective) return 'corrective';
  if (node === undefined) return 'fallback';
  if (SKIP_STATE_NODE_IDS.has(leaf)) return 'fallback';
  return NODE_ID_TO_STATE[leaf] ?? 'fallback';
}

/**
 * Registry of concrete state views keyed by `StateId`. A lookup — not a switch
 * ladder — so every state registers as a plain entry. Every `StateId` is now
 * registered; an id that somehow fails to resolve here still falls back via
 * `resolveStateView`'s `?? fallbackView`.
 */
const STATE_VIEW_REGISTRY: Partial<Record<StateId, StateView>> = {
  fallback: fallbackView,
  planning: planningView,
  'plan-approval': planApprovalView,
  coding: codingView,
  reviewing: reviewingView,
  corrective: correctiveView,
  'phase-review': phaseReviewView,
  'final-review': finalReviewView,
  complete: completeView,
};

/** Presentational dependencies the shell threads into every view context. */
export interface StateViewDeps {
  onDocClick: (path: string) => void;
  compareUrlByRepo: Record<string, string | null>;
  projectName: string;
}

function getPhaseLoop(state: AnyProjectState): ForEachPhaseNodeState | undefined {
  const node = state.graph.nodes['phase_loop'];
  return node && node.kind === 'for_each_phase' ? node : undefined;
}

/**
 * Resolves the active view and its context from `focus ?? current_node_path`.
 * The context carries the derived essentials (resolved node, phase name /
 * progress, iteration, repos, prUrl) merged with the shell's presentational
 * deps so views stay thin. Unmapped / unknown nodes resolve to the fallback
 * view; a registered-but-mapped id whose view is not yet in the registry also
 * falls back.
 */
export function resolveStateView(
  state: AnyProjectState,
  focus: string | undefined,
  deps: StateViewDeps,
): { view: StateView; ctx: StateViewContext } {
  const stateId = resolveStateId(state, focus);
  const view = STATE_VIEW_REGISTRY[stateId] ?? fallbackView;

  const path = normalizeFocus(focus, state.graph.current_node_path);
  const walk = path != null
    ? walkPath(state.graph.nodes, path)
    : { node: undefined, leaf: '', isCorrective: false, iteration: undefined, correctiveEntry: undefined };

  const phaseLoop = getPhaseLoop(state);
  const repos = walk.correctiveEntry?.repos ?? walk.iteration?.repos ?? [];

  const ctx: StateViewContext = {
    state,
    stateId,
    nodeId: walk.leaf,
    node: walk.node,
    isCorrective: walk.isCorrective,
    iteration: walk.iteration,
    correctiveEntry: walk.correctiveEntry,
    phaseName: deriveCurrentPhase(phaseLoop),
    phaseProgress: derivePhaseProgress(phaseLoop),
    repos,
    prUrl: state.pipeline.source_control?.repos?.[0]?.pr_url ?? null,
    onDocClick: deps.onDocClick,
    compareUrlByRepo: deps.compareUrlByRepo,
    projectName: deps.projectName,
  };

  return { view, ctx };
}
