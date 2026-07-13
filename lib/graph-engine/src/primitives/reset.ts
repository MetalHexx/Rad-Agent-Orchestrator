import type { NodeId, DagNode } from '../model/node.js';
import type { NodeStatus } from '../model/vocab.js';
import type { ChangeDelta, NodeChange, EdgeChange } from '../model/delta.js';
import type { Result } from '../result.js';
import type { GraphSnapshot } from '../derive/invariants.js';
import type { PrimitiveContext } from './primitive.js';
import { fail, findNode, runPrimitive } from './primitive.js';

/** The two statuses `reset` re-arms — the ones that mean the node actually ran. */
const RESETTABLE_STATUSES: readonly NodeStatus[] = ['done', 'in_progress'];

/** Exported so P02's `preview` shares this exact resettable check rather than a second copy. */
export function isResettable(status: NodeStatus): boolean {
  return RESETTABLE_STATUSES.includes(status);
}

/** Every direct containment child of `parentId` — never recurses. */
function directChildren(nodes: readonly DagNode[], parentId: NodeId): DagNode[] {
  return nodes.filter((node) => node.parent === parentId);
}

/**
 * The full prior expansion `originId` stamped: every node `expand(originId, ...)` created
 * (`derivedFrom === originId`) plus their own containment descendants, so a nested subgraph the
 * expansion seeded is torn down whole rather than leaving an orphaned remainder. Empty when
 * `originId` never expanded anything. Exported for reuse by any future caller needing this exact
 * cone walk — currently consumed only by `reset`'s own cascade below.
 */
export function priorExpansionCone(nodes: readonly DagNode[], originId: NodeId): NodeId[] {
  const cone: NodeId[] = [];
  const queue: NodeId[] = nodes.filter((node) => node.derivedFrom === originId).map((node) => node.id);
  const seen = new Set<NodeId>(queue);

  while (queue.length > 0) {
    const current = queue.shift() as NodeId;
    cone.push(current);
    for (const child of directChildren(nodes, current)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      queue.push(child.id);
    }
  }
  return cone;
}

/** The cascade walk's blast radius, as a pure read over `graph` — see {@link computeResetCascade}. */
export interface ResetCascadeComputation {
  /** Every node id that would flip back to `not_started`, `node` itself included when it ran. */
  readonly resetIds: readonly NodeId[];
  /** Every node id whose entire prior expansion would be torn down (removed) rather than reset. */
  readonly tornDownIds: readonly NodeId[];
  /** Mutable, matching `ChangeDelta`'s own shape — `reset` assigns these straight into its commit. */
  readonly nodeChanges: NodeChange[];
  readonly edgeChanges: EdgeChange[];
}

/**
 * The cascade blast radius `reset(node, true)` computes and commits — factored out so P02's
 * `preview` reads the exact same walk rather than a second copy. Starting from `node`, resets every
 * downstream node already reached (via `depends_on` dependents, transitively) that itself already
 * ran, stopping at the first dependent that never ran (nothing beyond it could have run either) —
 * and, at each such node, tears down whatever it previously expanded (`expand`'s `derivedFrom`
 * stamp) outright rather than resetting it, so a fresh run re-seeds instead of colliding with stale
 * ids. Yields an empty computation when `node` itself never ran — the same "nothing to reset"
 * outcome `reset` itself turns into a rejection.
 */
export function computeResetCascade(graph: GraphSnapshot, node: NodeId): ResetCascadeComputation {
  const nodeChanges: NodeChange[] = [];
  const edgeChanges: EdgeChange[] = [];
  const removedIds = new Set<NodeId>();
  const resetIds = new Set<NodeId>();

  function tearDownExpansion(originId: NodeId): void {
    const cone = priorExpansionCone(graph.nodes, originId).filter((id) => !removedIds.has(id));
    if (cone.length === 0) return;

    const coneSet = new Set(cone);
    for (const id of cone) {
      removedIds.add(id);
      const before = findNode(graph, id);
      if (before) nodeChanges.push({ op: 'removed', before, after: null });
    }
    for (const edge of graph.edges) {
      if (coneSet.has(edge.from) || coneSet.has(edge.to)) {
        edgeChanges.push({ op: 'removed', before: edge, after: null });
      }
    }
  }

  function visit(id: NodeId): void {
    if (resetIds.has(id) || removedIds.has(id)) return;
    const current = findNode(graph, id);
    if (!current || !isResettable(current.status)) return; // never ran — nothing downstream could have either

    resetIds.add(id);
    const after: DagNode = { ...current, status: 'not_started' };
    nodeChanges.push({ op: 'updated', before: current, after });

    tearDownExpansion(id);

    for (const edge of graph.edges) {
      if (edge.kind === 'depends_on' && edge.from === id) visit(edge.to);
    }
  }

  visit(node);

  return { resetIds: [...resetIds], tornDownIds: [...removedIds], nodeChanges, edgeChanges };
}

/**
 * Flips `node` from `done`/`in_progress` back to `not_started` — the same node, never a new one —
 * so it becomes frontier-*eligible* again (it only actually re-enters once its own readiness holds:
 * e.g. a dependency `add_corrective` just re-pointed onto it). Rejects a node that hasn't run
 * (already `not_started`, or halted `blocked`/`failed` — see `resume` for that axis instead).
 *
 * Without `cascade`, this touches only `node`. With `cascade`, see {@link computeResetCascade} for
 * the downstream blast radius this commits.
 */
export function reset(ctx: PrimitiveContext, node: NodeId, cascade = false): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const target = findNode(graph, node);
    if (!target) return fail('invalid_delta', `node '${node}' does not exist`);
    if (!isResettable(target.status)) {
      return fail(
        'invalid_delta',
        `node '${node}' has status '${target.status}'; reset only re-arms 'done'/'in_progress' nodes`,
      );
    }

    if (!cascade) {
      const after: DagNode = { ...target, status: 'not_started' };
      return {
        ok: true,
        data: {
          primitive: 'reset',
          params: { node, cascade },
          nodeChanges: [{ op: 'updated', before: target, after }],
          edgeChanges: [],
        },
      };
    }

    const { nodeChanges, edgeChanges } = computeResetCascade(graph, node);

    return {
      ok: true,
      data: {
        primitive: 'reset',
        params: { node, cascade },
        nodeChanges,
        edgeChanges,
      },
    };
  });
}
