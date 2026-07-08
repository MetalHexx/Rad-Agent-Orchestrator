import type { DagEdge } from '../model/edge.js';
import type { DagNode, NodeId } from '../model/node.js';
import type { Result } from '../result.js';
import { ROOT_NODE_ID } from '../model/root.js';
import { assertNever } from '../model/vocab.js';
import type { GraphSnapshot, MutationSpec } from './invariants.js';
import { violatesRootGuard, wouldCreateCycle, wouldCreateParentCycle } from './invariants.js';

/**
 * The blast radius a destructive mutation would touch, as a read — the exact node ids and edges a
 * `remove_node`/`move_node` would affect, computed without ever writing to a store.
 */
export interface PreviewCone {
  readonly nodeIds: readonly NodeId[];
  readonly edges: readonly DagEdge[];
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
      return { ok: true, data: undefined };
    }
    default:
      return assertNever(mutationSpec);
  }
}

/** `nodeId` plus every descendant reachable through `parent`, breadth-first — containment only, never `depends_on`. */
function descendantCone(nodes: readonly DagNode[], nodeId: NodeId): NodeId[] {
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
 * "What would this affect?" — the blast radius a mutation would touch, computed without a store
 * write. For `remove_node` under a `cascade` strategy: the node itself plus every descendant reached
 * through `parent` (containment, never `depends_on` — dependency edges gate ordering, not who gets
 * removed), plus every edge incident to any of those nodes (the ones referential integrity would
 * otherwise leave dangling). A non-cascading `remove_node` touches only the node itself and its own
 * incident edges. `add_dependency`/`move_node` are non-destructive; their cone is the surface the
 * change itself introduces or touches, not a removal.
 */
export function preview(graph: GraphSnapshot, mutationSpec: MutationSpec): PreviewCone {
  switch (mutationSpec.kind) {
    case 'remove_node': {
      const nodeIds = mutationSpec.cascade
        ? descendantCone(graph.nodes, mutationSpec.nodeId)
        : [mutationSpec.nodeId];
      const idSet = new Set(nodeIds);
      const edges = graph.edges.filter((edge) => idSet.has(edge.from) || idSet.has(edge.to));
      return { nodeIds, edges };
    }
    case 'move_node':
      return { nodeIds: [mutationSpec.nodeId], edges: [] };
    case 'add_dependency':
      return { nodeIds: [], edges: [{ from: mutationSpec.from, to: mutationSpec.to, kind: 'depends_on' }] };
    default:
      return assertNever(mutationSpec);
  }
}
