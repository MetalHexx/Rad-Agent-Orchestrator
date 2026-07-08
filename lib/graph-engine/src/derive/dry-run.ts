import type { DagEdge } from '../model/edge.js';
import type { DagNode, NodeId } from '../model/node.js';
import type { Result } from '../result.js';
import { ROOT_NODE_ID } from '../model/root.js';
import { assertNever } from '../model/vocab.js';
import type { GraphSnapshot, MutationSpec } from './invariants.js';
import {
  violatesRootGuard,
  wouldCreateCycle,
  wouldCreateParentCycle,
  wouldCrossContainmentAxis,
  wouldCrossContainmentAxisOnMove,
} from './invariants.js';
import { computeExpansion } from '../primitives/expand.js';
import { computeAddCorrective } from '../primitives/corrective.js';
import { computeResetCascade, isResettable } from '../primitives/reset.js';

/**
 * The blast radius a destructive mutation would touch, as a read — the exact node ids and edges a
 * `remove_node`/`move_node` would affect, computed without ever writing to a store.
 */
export interface PreviewCone {
  readonly nodeIds: readonly NodeId[];
  readonly edges: readonly DagEdge[];
}

/**
 * The effect set a prospective `add_corrective` call would produce — the corrective node + gate
 * edge it would create and the review's resulting node, or the would-halt outcome when the retry
 * budget is already met/exceeded. Computed by the exact same `computeAddCorrective` the primitive
 * itself commits through, so this can never disagree with what `add_corrective` actually does.
 * `null` fields on a halt (no corrective is minted) or when the underlying computation is illegal
 * (e.g. `review` doesn't exist) — call `validate` first to distinguish the two.
 */
export interface AddCorrectivePreview {
  readonly wouldHalt: boolean;
  readonly correctiveNode: DagNode | null;
  readonly gateEdge: DagEdge | null;
  readonly reviewAfter: DagNode | null;
}

/**
 * The cascade cone `reset(node, cascade)` would touch — computed by the exact same
 * `computeResetCascade` walk `reset`'s own cascade branch commits through. A non-resettable target
 * (or, for a non-cascading reset, any target that never ran) yields an empty cone rather than a
 * rejection — `reset` itself is the one that turns that into a hard `invalid_delta` error.
 */
export interface ResetPreview {
  /** Nodes that would flip back to `not_started`. */
  readonly resetNodeIds: readonly NodeId[];
  /** Nodes whose entire prior expansion would be torn down (removed) rather than reset. */
  readonly tornDownNodeIds: readonly NodeId[];
  readonly removedEdges: readonly DagEdge[];
}

/**
 * "Would this be legal?" — runs the invariant relevant to `mutationSpec`'s kind against `graph` and
 * returns a structured `EngineError` on failure. Touches neither `graph` nor any store: this is the
 * same seam the mutation primitives (P03) run internally before committing, factored out here so a
 * visual editor can ask the question without a commit.
 */
export function validate(graph: GraphSnapshot, mutationSpec: MutationSpec): Result<void> {
  if (violatesRootGuard(mutationSpec)) {
    return {
      ok: false,
      error: {
        code: 'root_guarded',
        message: `'${ROOT_NODE_ID}' is the project-scoped root and can never be removed or re-parented`,
      },
    };
  }

  switch (mutationSpec.kind) {
    case 'add_dependency': {
      const candidate: DagEdge = { from: mutationSpec.from, to: mutationSpec.to, kind: 'depends_on' };
      if (wouldCreateCycle(graph.edges, candidate)) {
        return {
          ok: false,
          error: {
            code: 'cycle',
            message: `'${mutationSpec.from}' -> '${mutationSpec.to}' would create a depends_on cycle`,
          },
        };
      }
      if (wouldCrossContainmentAxis(graph.nodes, mutationSpec.from, mutationSpec.to)) {
        return {
          ok: false,
          error: {
            code: 'cross_axis_cycle',
            message:
              `'${mutationSpec.from}' -> '${mutationSpec.to}' would create a depends_on edge between ` +
              `containment-related nodes (one is the other's ancestor)`,
          },
        };
      }
      return { ok: true, data: undefined };
    }
    case 'remove_node':
      return { ok: true, data: undefined };
    case 'move_node': {
      if (wouldCreateParentCycle(graph.nodes, mutationSpec.nodeId, mutationSpec.newParent)) {
        return {
          ok: false,
          error: {
            code: 'cycle',
            message:
              `moving '${mutationSpec.nodeId}' under '${mutationSpec.newParent}' would create a ` +
              `containment cycle`,
          },
        };
      }
      if (
        wouldCrossContainmentAxisOnMove(graph.nodes, graph.edges, mutationSpec.nodeId, mutationSpec.newParent)
      ) {
        return {
          ok: false,
          error: {
            code: 'cross_axis_cycle',
            message:
              `moving '${mutationSpec.nodeId}' under '${mutationSpec.newParent}' would newly relate a ` +
              `depends_on edge's endpoints by containment`,
          },
        };
      }
      return { ok: true, data: undefined };
    }
    case 'expand': {
      const computed = computeExpansion(graph, mutationSpec.registry, mutationSpec.node, mutationSpec.expansion);
      if (!computed.ok) return computed;
      return { ok: true, data: undefined };
    }
    case 'add_corrective': {
      const computed = computeAddCorrective(
        graph,
        mutationSpec.id,
        mutationSpec.type,
        mutationSpec.review,
        mutationSpec.options,
      );
      if (!computed.ok) return computed;
      return { ok: true, data: undefined };
    }
    case 'reset':
      // No dedicated legality check of its own: whether `node` is actually resettable is a
      // data-dependent read `preview` surfaces as an empty cone (see `ResetPreview`), not a
      // validate rejection — mirroring `reset`'s own halt-vs-reject split for `add_corrective`.
      return { ok: true, data: undefined };
    default:
      return assertNever(mutationSpec);
  }
}

/**
 * `nodeId` plus every descendant reachable through `parent`, breadth-first — containment only,
 * never `depends_on`. Exported so `remove_node` (P03) shares this exact walk rather than forking
 * its own copy — the same reason `preview` and the primitive's actual removal set must never
 * disagree on what a cascade touches.
 */
export function descendantCone(nodes: readonly DagNode[], nodeId: NodeId): NodeId[] {
  const childrenByParent = new Map<NodeId, NodeId[]>();
  for (const node of nodes) {
    if (node.parent === null) continue;
    const siblings = childrenByParent.get(node.parent);
    if (siblings) siblings.push(node.id);
    else childrenByParent.set(node.parent, [node.id]);
  }

  const cone: NodeId[] = [nodeId];
  const queue: NodeId[] = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift() as NodeId;
    for (const childId of childrenByParent.get(current) ?? []) {
      cone.push(childId);
      queue.push(childId);
    }
  }
  return cone;
}

/**
 * Every node transitively gated (via `depends_on`) on any node already in `seedIds`, each pulled in
 * together with its own containment descendants — the identical sweep `remove_node`'s `dependents:
 * 'cascade'` strategy (P03) performs on commit, factored here so `preview` reports the same blast
 * radius rather than a second, independently-maintained copy of the walk. Never crosses into the
 * root (a removal can never reach the project-scoped root through this sweep).
 */
export function dependentsCascadeCone(graph: GraphSnapshot, seedIds: readonly NodeId[]): NodeId[] {
  const cone = new Set<NodeId>(seedIds);
  const queue: NodeId[] = [...seedIds];
  while (queue.length > 0) {
    const current = queue.shift() as NodeId;
    for (const edge of graph.edges) {
      if (edge.kind !== 'depends_on' || edge.from !== current) continue;
      if (edge.to === ROOT_NODE_ID || cone.has(edge.to)) continue;
      for (const id of descendantCone(graph.nodes, edge.to)) {
        if (!cone.has(id)) {
          cone.add(id);
          queue.push(id);
        }
      }
    }
  }
  return [...cone];
}

/**
 * "What would this affect?" — the blast radius a mutation would touch, computed without a store
 * write. For `remove_node` under a `cascade` strategy: the node itself plus every descendant reached
 * through `parent` (containment, never `depends_on` — dependency edges gate ordering, not who gets
 * removed). `dependentsCascade` folds in the transitive `depends_on` sweep too — every node gated
 * (directly or transitively) on any node already in the cone, each with its own containment
 * descendants — mirroring `remove_node`'s `dependents: 'cascade'` strategy exactly. Either way the
 * cone also includes every edge incident to any touched node (the ones referential integrity would
 * otherwise leave dangling). A non-cascading `remove_node` touches only the node itself and its own
 * incident edges. `add_dependency`/`move_node` are non-destructive; their cone is the surface the
 * change itself introduces or touches, not a removal. `add_corrective`/`reset` return their own
 * richer shape ({@link AddCorrectivePreview}/{@link ResetPreview}) instead of a `PreviewCone` — the
 * overloads below narrow the return type to the shape each `mutationSpec.kind` actually produces.
 */
export function preview(
  graph: GraphSnapshot,
  mutationSpec: Extract<MutationSpec, { kind: 'add_corrective' }>,
): AddCorrectivePreview;
export function preview(graph: GraphSnapshot, mutationSpec: Extract<MutationSpec, { kind: 'reset' }>): ResetPreview;
export function preview(
  graph: GraphSnapshot,
  mutationSpec: Exclude<MutationSpec, { kind: 'add_corrective' | 'reset' }>,
): PreviewCone;
export function preview(
  graph: GraphSnapshot,
  mutationSpec: MutationSpec,
): PreviewCone | AddCorrectivePreview | ResetPreview {
  switch (mutationSpec.kind) {
    case 'remove_node': {
      const containmentIds = mutationSpec.cascade
        ? descendantCone(graph.nodes, mutationSpec.nodeId)
        : [mutationSpec.nodeId];
      const nodeIds = mutationSpec.dependentsCascade
        ? dependentsCascadeCone(graph, containmentIds)
        : containmentIds;
      const idSet = new Set(nodeIds);
      const edges = graph.edges.filter((edge) => idSet.has(edge.from) || idSet.has(edge.to));
      return { nodeIds, edges };
    }
    case 'move_node':
      return { nodeIds: [mutationSpec.nodeId], edges: [] };
    case 'add_dependency':
      return { nodeIds: [], edges: [{ from: mutationSpec.from, to: mutationSpec.to, kind: 'depends_on' }] };
    case 'expand': {
      const computed = computeExpansion(graph, mutationSpec.registry, mutationSpec.node, mutationSpec.expansion);
      if (!computed.ok) return { nodeIds: [], edges: [] };
      return {
        nodeIds: computed.data.nodeChanges.map((change) => (change.after as DagNode).id),
        edges: computed.data.edgeChanges.map((change) => change.after as DagEdge),
      };
    }
    case 'add_corrective': {
      const computed = computeAddCorrective(
        graph,
        mutationSpec.id,
        mutationSpec.type,
        mutationSpec.review,
        mutationSpec.options,
      );
      if (!computed.ok) return { wouldHalt: false, correctiveNode: null, gateEdge: null, reviewAfter: null };
      return {
        wouldHalt: computed.data.wouldHalt,
        correctiveNode: computed.data.correctiveNode,
        gateEdge: computed.data.gateEdge,
        reviewAfter: computed.data.reviewAfter,
      };
    }
    case 'reset': {
      if (!mutationSpec.cascade) {
        const target = graph.nodes.find((n) => n.id === mutationSpec.node);
        const resetNodeIds = target && isResettable(target.status) ? [target.id] : [];
        return { resetNodeIds, tornDownNodeIds: [], removedEdges: [] };
      }
      const cascade = computeResetCascade(graph, mutationSpec.node);
      const removedEdges = cascade.edgeChanges
        .map((change) => change.before)
        .filter((edge): edge is DagEdge => edge !== null);
      return { resetNodeIds: cascade.resetIds, tornDownNodeIds: cascade.tornDownIds, removedEdges };
    }
    default:
      return assertNever(mutationSpec);
  }
}
