import type { DagNode, NodeId } from '../model/node.js';
import type { DagEdge } from '../model/edge.js';
import { ROOT_NODE_ID } from '../model/root.js';
import { assertNever } from '../model/vocab.js';

/**
 * A read-only nodes+edges snapshot — what `validate`/`preview` (and, later, the mutation
 * primitives) check a proposed change against. Never a live handle onto a `StateStore`: a caller
 * takes one via `listNodes`/`listEdges` and passes it in, so these checks stay pure functions of
 * their arguments.
 */
export interface GraphSnapshot {
  readonly nodes: readonly DagNode[];
  readonly edges: readonly DagEdge[];
}

/**
 * The proposed change every invariant predicate, `validate`, and `preview` run against. Deliberately
 * narrow to the mutation shapes an invariant actually gates — the full primitive surface is P03's to
 * define; this is not that registry, only the seam the checks are factored against so P03 can share
 * it rather than fork its own copy.
 */
export type MutationSpec =
  | { readonly kind: 'add_dependency'; readonly from: NodeId; readonly to: NodeId }
  | {
      readonly kind: 'remove_node';
      readonly nodeId: NodeId;
      readonly cascade: boolean;
      /**
       * Whether the removal also transitively sweeps every node gated (directly or transitively,
       * via `depends_on`) on `nodeId` — the `dependents: 'cascade'` strategy axis (P03). Optional;
       * absent/`false` scopes `preview`'s blast radius to the containment (`cascade`) axis only.
       */
      readonly dependentsCascade?: boolean;
    }
  | { readonly kind: 'move_node'; readonly nodeId: NodeId; readonly newParent: NodeId };

// ── Acyclicity: depends_on forms a DAG ──────────────────────────────────────────

/**
 * Textbook DFS 3-coloring cycle detection over a directed `depends_on` edge set: white (unvisited),
 * gray (on the current recursion stack), black (fully explored). Revisiting a gray node means the
 * walk has looped back onto its own stack — a cycle. Returns the cyclic node-id path if one exists,
 * `null` otherwise. This is the single cycle-check implementation `validate` calls below and the
 * mutation primitives (P03) call internally — neither forks its own copy.
 */
export function detectCycle(edges: readonly DagEdge[]): NodeId[] | null {
  const successors = new Map<NodeId, NodeId[]>();
  for (const edge of edges) {
    const existing = successors.get(edge.from);
    if (existing) existing.push(edge.to);
    else successors.set(edge.from, [edge.to]);
  }

  const color = new Map<NodeId, 'gray' | 'black'>();
  const stack: NodeId[] = [];

  function visit(nodeId: NodeId): NodeId[] | null {
    color.set(nodeId, 'gray');
    stack.push(nodeId);

    for (const next of successors.get(nodeId) ?? []) {
      const nextColor = color.get(next);
      if (nextColor === 'gray') return stack.slice(stack.indexOf(next));
      if (nextColor === undefined) {
        const found = visit(next);
        if (found) return found;
      }
    }

    stack.pop();
    color.set(nodeId, 'black');
    return null;
  }

  for (const nodeId of successors.keys()) {
    if (!color.has(nodeId)) {
      const found = visit(nodeId);
      if (found) return found;
    }
  }
  return null;
}

/** Whether adding `candidate` to `edges` would create a `depends_on` cycle — reuses `detectCycle`. */
export function wouldCreateCycle(edges: readonly DagEdge[], candidate: DagEdge): boolean {
  return detectCycle([...edges, candidate]) !== null;
}

// ── Tree-shape: parent forms a tree ─────────────────────────────────────────────

/**
 * Whether every node's `parent` chain terminates (reaches `null` or an unknown id) without
 * revisiting a node already on the walk. `DagNode.parent` is a single field rather than a list, so
 * "single parent" already holds structurally; the one way a `parent` graph stops being a tree is a
 * cycle in that chain.
 */
export function isTreeShaped(nodes: readonly DagNode[]): boolean {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const seen = new Set<NodeId>();
    let current: NodeId | null = node.id;
    while (current !== null) {
      if (seen.has(current)) return false;
      seen.add(current);
      current = nodesById.get(current)?.parent ?? null;
    }
  }
  return true;
}

/**
 * Whether re-parenting `nodeId` under `newParent` would create a containment cycle: true when
 * `newParent` is `nodeId` itself or already one of its descendants (walking `newParent`'s current
 * chain back up and finding `nodeId` on it).
 */
export function wouldCreateParentCycle(nodes: readonly DagNode[], nodeId: NodeId, newParent: NodeId): boolean {
  if (newParent === nodeId) return true;

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<NodeId>();
  let current: NodeId | null = newParent;
  while (current !== null) {
    if (current === nodeId) return true;
    if (seen.has(current)) return false; // a pre-existing cycle elsewhere — not this move's doing
    seen.add(current);
    current = nodesById.get(current)?.parent ?? null;
  }
  return false;
}

// ── Order-advisory: order never contradicts a depends_on edge ──────────────────

/** A sibling pair whose authored `order` disagrees with a `depends_on` edge between them. */
export interface OrderContradiction {
  readonly predecessor: NodeId;
  readonly dependent: NodeId;
}

/**
 * `DagNode.order` is authored sibling display/pick order — advisory only, never read by the
 * frontier. This surfaces every sibling pair where it disagrees with a `depends_on` edge between
 * them (the predecessor's order does not sort strictly before its dependent's). Informational only:
 * it is never a `validate` rejection reason, and order is sibling-scoped so cross-parent pairs are
 * never compared.
 */
export function findOrderContradictions(
  nodes: readonly DagNode[],
  edges: readonly DagEdge[],
): OrderContradiction[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const contradictions: OrderContradiction[] = [];
  for (const edge of edges) {
    if (edge.kind !== 'depends_on') continue;
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) continue;
    if (from.parent !== to.parent) continue;
    if (from.order >= to.order) contradictions.push({ predecessor: edge.from, dependent: edge.to });
  }
  return contradictions;
}

// ── Root-guard: the project-scoped root is never removed or re-parented ────────

/** Whether `mutationSpec` would remove or re-parent the project-scoped root. */
export function violatesRootGuard(mutationSpec: MutationSpec): boolean {
  switch (mutationSpec.kind) {
    case 'remove_node':
      return mutationSpec.nodeId === ROOT_NODE_ID;
    case 'move_node':
      return mutationSpec.nodeId === ROOT_NODE_ID;
    case 'add_dependency':
      return false;
    default:
      return assertNever(mutationSpec);
  }
}
