import type { NodeId, DagNode } from '../model/node.js';
import type { DagEdge } from '../model/edge.js';
import type { ChangeDelta, NodeChange, EdgeChange } from '../model/delta.js';
import type { Result } from '../result.js';
import type { GraphSnapshot } from '../derive/invariants.js';
import type { NodeTypeRegistry } from '../node-type/registry.js';
import type { Expansion } from './expand.js';
import { computeExpansion } from './expand.js';
import { priorExpansionCone } from './reset.js';
import type { PrimitiveContext } from './primitive.js';
import { fail, findNode, runPrimitive } from './primitive.js';

/** An edge's structural identity — `DagEdge` carries no other payload, so this is also its equality key. */
function edgeKey(edge: Pick<DagEdge, 'from' | 'to' | 'kind'>): string {
  return `${edge.kind}:${edge.from}->${edge.to}`;
}

/**
 * The atomic re-explode `replace_expansion` commits — factored out so a future `preview` could read
 * the exact same computation, mirroring every other primitive's `compute*` split. Tears down
 * `node`'s entire prior expansion (via `priorExpansionCone`, the same walk `reset`'s cascade uses)
 * and resolves `expansion` in one delta, against a graph projected as though that prior expansion
 * never existed — so a fresh batch may reuse the exact same `NodeSpec.key`s the torn-down expansion
 * used without tripping `computeExpansion`'s own "collides with an existing node id" rejection, and
 * without ever surfacing an intermediate state where both the old and new subgraphs coexist.
 *
 * A reused id resolves to a single `updated` node change (old node's fields replaced by the new
 * spec's, `status` reset to `not_started` like every fresh `expand` output) rather than a
 * `removed` + `created` pair: `StateStore.apply` plans each node change against the *pre-delta*
 * state, so a same-delta remove-then-recreate of one id would be rejected as "already exists" even
 * though the net effect is a legal in-place replacement — reconciling to `updated` sidesteps that
 * without weakening the store's per-change checks. The identical case for an edge whose `{from,to,
 * kind}` identity survives the replace unchanged is reconciled to a no-op (neither removed nor
 * recreated) for the same reason; every edge for which no equal-identity edge survives elsewhere
 * remains `removed`.
 *
 * Only edges touching the torn-down cone are removed — an edge into or out of a reused id is torn
 * down and then only restored if `expansion`'s own specs re-declare it (exactly like `expand` itself:
 * re-pointing an already-existing node's edge onto the new subgraph is the caller's job). Rejects on:
 * `node` not existing, or anything `computeExpansion` itself would reject when resolving `expansion`
 * against the post-teardown graph (unknown node type, a batch key colliding with a *surviving*
 * node id, an unresolved `parent`/`dependsOn` reference, a containment cycle among batch keys, or a
 * `depends_on` cycle/broken tree shape the resolved batch would introduce).
 */
export function computeReplaceExpansion(
  graph: GraphSnapshot,
  registry: NodeTypeRegistry,
  node: NodeId,
  expansion: Expansion,
): Result<ChangeDelta> {
  if (!findNode(graph, node)) return fail('invalid_delta', `node '${node}' does not exist`);

  const coneIds = new Set(priorExpansionCone(graph.nodes, node));
  const coneNodesById = new Map(graph.nodes.filter((n) => coneIds.has(n.id)).map((n) => [n.id, n]));
  const coneEdges = graph.edges.filter((edge) => coneIds.has(edge.from) || coneIds.has(edge.to));

  const projectedGraph: GraphSnapshot = {
    nodes: graph.nodes.filter((n) => !coneIds.has(n.id)),
    edges: graph.edges.filter((edge) => !coneIds.has(edge.from) && !coneIds.has(edge.to)),
  };

  const expanded = computeExpansion(projectedGraph, registry, node, expansion);
  if (!expanded.ok) return expanded;

  const reusedIds = new Set<NodeId>();
  const nodeChanges: NodeChange[] = [];
  for (const change of expanded.data.nodeChanges) {
    const after = change.after as DagNode;
    const priorNode = coneNodesById.get(after.id);
    if (priorNode) {
      reusedIds.add(after.id);
      nodeChanges.push({ op: 'updated', before: priorNode, after });
    } else {
      nodeChanges.push(change);
    }
  }
  for (const priorNode of coneNodesById.values()) {
    if (!reusedIds.has(priorNode.id)) nodeChanges.push({ op: 'removed', before: priorNode, after: null });
  }

  const coneEdgeKeys = new Set(coneEdges.map(edgeKey));
  const reusedEdgeKeys = new Set<string>();
  const createdEdgeChanges: EdgeChange[] = [];
  for (const change of expanded.data.edgeChanges) {
    const after = change.after as DagEdge;
    const key = edgeKey(after);
    if (coneEdgeKeys.has(key)) {
      reusedEdgeKeys.add(key);
      continue; // identical edge survives the replace unchanged — neither removed nor recreated
    }
    createdEdgeChanges.push(change);
  }
  const removedEdgeChanges: EdgeChange[] = coneEdges
    .filter((edge) => !reusedEdgeKeys.has(edgeKey(edge)))
    .map((edge) => ({ op: 'removed' as const, before: edge, after: null }));

  return {
    ok: true,
    data: {
      primitive: 'replace_expansion',
      params: { node, expansion },
      nodeChanges,
      edgeChanges: [...removedEdgeChanges, ...createdEdgeChanges],
    },
  };
}

/**
 * The re-explode primitive an audit-correction needs: atomically tears down `node`'s prior `expand`
 * output and re-expands `expansion` in its place. See {@link computeReplaceExpansion} for exactly
 * what "reused id"/"reused edge" reconciliation means — it is what makes a repeated call with an
 * identical `expansion` idempotent rather than a rejection. Unlike `reset(node, true)`, this never
 * touches `node` itself or anything upstream of it — a caller that also needs `node` re-armed issues
 * `reset(node)` (non-cascading) alongside this, in whichever order its own transition requires.
 */
export function replace_expansion(
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  node: NodeId,
  expansion: Expansion,
): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => computeReplaceExpansion(graph, registry, node, expansion));
}
