import type { DagNode, NodeId } from '../model/node.js';
import type { DagEdge } from '../model/edge.js';
import type { NodeStatus } from '../model/vocab.js';
import { detectCycle, isTreeShaped } from './invariants.js';

/**
 * Precondition guard shared by `frontier`/`remaining`: both recurse through the `parent` chain
 * (ancestor walk and children roll-up alike) with no in-flight cycle guard of their own, so a
 * caller is expected to keep containment tree-shaped (e.g. by routing every `move_node` through
 * `validate`) before deriving status from it. Throws loudly and cheaply — via the exact
 * `isTreeShaped` check `validate` itself runs — rather than letting a malformed or adversarial
 * graph overflow the call stack.
 */
function assertTreeShapedInput(nodes: readonly DagNode[]): void {
  if (!isTreeShaped(nodes)) {
    throw new Error('cannot derive status: parent chain contains a cycle');
  }
}

/**
 * Precondition guard for `frontier`: `predecessorsDone` recurses through `depends_on` edges with
 * no in-flight cycle guard of its own, so a caller is expected to keep the edge set acyclic (e.g.
 * by routing every `add_dependency` through `validate`) before deriving status from it. Same
 * rationale and idiom as `assertTreeShapedInput`, via the exact `detectCycle` check `validate`
 * itself runs.
 */
function assertAcyclicInput(edges: readonly DagEdge[]): void {
  const cycle = detectCycle(edges);
  if (cycle) {
    throw new Error(`cannot derive status: depends_on cycle detected: ${cycle.join(' -> ')}`);
  }
}

/** Groups nodes by `parent`, skipping the one node with no container (`parent === null`). */
function groupChildrenByParent(nodes: readonly DagNode[]): Map<NodeId, DagNode[]> {
  const byParent = new Map<NodeId, DagNode[]>();
  for (const node of nodes) {
    if (node.parent === null) continue;
    const siblings = byParent.get(node.parent);
    if (siblings) siblings.push(node);
    else byParent.set(node.parent, [node]);
  }
  return byParent;
}

/**
 * The single source of a container's rolled-up status, given its own record and its children's
 * already-resolved statuses. Containment is structural — a node with no children is never routed
 * here (it reads as a leaf/work node instead) — so an empty `children` array only occurs when this
 * function is called directly (e.g. by a test); it reads as `in_progress` in that case, since there
 * is nothing yet to roll up. `node` is carried for parity with the rest of the model even though
 * the roll-up itself is purely a function of `children`.
 */
export function deriveContainerStatus(node: DagNode, children: readonly DagNode[]): NodeStatus {
  if (children.length === 0) return 'in_progress';
  if (children.some((child) => child.status === 'failed')) return 'failed';
  if (children.every((child) => child.status === 'done')) return 'done';
  return 'in_progress';
}

/**
 * Resolves every node's effective status on demand, memoized per call. A leaf/work node (no
 * children, or the containerless root) reads its own persisted `status` verbatim; a container
 * reads `deriveContainerStatus` over its children's own resolved statuses instead — its raw
 * `status` field is never consulted, so there is no written container status to drift.
 */
function createStatusResolver(nodes: readonly DagNode[], edges: readonly DagEdge[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = groupChildrenByParent(nodes);
  const statusMemo = new Map<NodeId, NodeStatus>();
  const beganMemo = new Map<NodeId, boolean>();
  const beganInFlight = new Set<NodeId>();

  function predecessorsDone(nodeId: NodeId): boolean {
    return edges
      .filter((edge) => edge.kind === 'depends_on' && edge.to === nodeId)
      .every((edge) => resolve(edge.from) === 'done');
  }

  /**
   * Whether `node` has been entered: every ancestor has itself been entered, and `node`'s own
   * predecessors are done. Deliberately independent of `node`'s children — a container waiting on
   * its own roll-up to know whether it's entered would have to roll up before it could know
   * whether it was allowed to. The root is entered vacuously (seeded `in_progress`, no parent),
   * which is what makes the top-level spine frontier-eligible on tick one.
   *
   * `beganInFlight` guards re-entrancy: a `depends_on` edge whose endpoints are also
   * containment-related (rejected by `validate` for state reachable through the public
   * primitives, but not provable from `nodes`/`edges` alone) would otherwise walk back up onto a
   * `node.id` still mid-computation — `predecessorsDone` resolving a descendant that itself calls
   * back into `hasBegun` on an ancestor — and recurse unbounded. Same DFS-coloring idiom as
   * `detectCycle`: a node revisited while still gray throws a clean, typed-message error instead
   * of overflowing the call stack.
   */
  function hasBegun(node: DagNode): boolean {
    const cached = beganMemo.get(node.id);
    if (cached !== undefined) return cached;
    if (beganInFlight.has(node.id)) {
      throw new Error(
        `cannot derive status: '${node.id}' recurses back onto itself while resolving whether it has ` +
          'begun — a depends_on edge crosses a containment (parent/descendant) relationship',
      );
    }

    beganInFlight.add(node.id);
    let result: boolean;
    if (node.parent === null) {
      result = true;
    } else {
      const parent = nodesById.get(node.parent);
      result = parent !== undefined && hasBegun(parent) && predecessorsDone(node.id);
    }
    beganInFlight.delete(node.id);

    beganMemo.set(node.id, result);
    return result;
  }

  function resolve(nodeId: NodeId): NodeStatus {
    const cached = statusMemo.get(nodeId);
    if (cached !== undefined) return cached;

    const node = nodesById.get(nodeId);
    if (!node) return 'not_started';

    const children = childrenByParent.get(node.id) ?? [];
    let result: NodeStatus;
    if (node.parent === null || children.length === 0) {
      result = node.status;
    } else if (!hasBegun(node)) {
      result = 'not_started';
    } else {
      const resolvedChildren = children.map((child) => ({ ...child, status: resolve(child.id) }));
      result = deriveContainerStatus(node, resolvedChildren);
    }

    statusMemo.set(nodeId, result);
    return result;
  }

  return { nodesById, childrenByParent, resolve, predecessorsDone };
}

/**
 * The nodes eligible to be picked up right now, under `scope`: `not_started`, every `depends_on`
 * predecessor `done`, the parent container entered (resolved status `in_progress`), not `disabled`,
 * and a direct child of `scope` (root scope surfaces its phases/tasks; a phase scope surfaces its
 * tasks). Only leaf/work nodes are ever engine-engaged — a node with its own children is a
 * container, gated purely by dependency edges, and never appears here itself. A corrective needs no
 * special case: it is a new node like any other, so once every one of its own predecessors is
 * `done` — including whichever review it gates, itself gated on the corrective plus every earlier
 * attempt `add_corrective` stacked onto the same review rather than replacing — it falls out of
 * this same uniform rule.
 *
 * Precondition: `nodes`/`edges` must already be acyclic and tree-shaped (as `validate` would
 * confirm before a mutation commits) — this is a read over an assumed-valid graph, not a
 * validator. Throws on a `depends_on` or `parent`-chain cycle rather than recursing unbounded.
 */
export function frontier(nodes: readonly DagNode[], edges: readonly DagEdge[], scope: NodeId): DagNode[] {
  assertAcyclicInput(edges);
  assertTreeShapedInput(nodes);

  const { nodesById, childrenByParent, resolve, predecessorsDone } = createStatusResolver(nodes, edges);

  if (!nodesById.has(scope) || resolve(scope) !== 'in_progress') return [];

  return nodes.filter((node) => {
    if (node.parent !== scope) return false;
    if (node.status !== 'not_started') return false;
    if (node.disabled) return false;
    if ((childrenByParent.get(node.id)?.length ?? 0) > 0) return false;
    return predecessorsDone(node.id);
  });
}

/**
 * Everything not yet `done` under `scope` — the roadmap the UI grays out as work completes. A
 * distinct read from `frontier`: it needs no dependency edges, only completion, and it includes
 * disabled and not-yet-eligible nodes alongside anything still in flight.
 *
 * Precondition: `nodes`' `parent` pointers must already be tree-shaped (as `validate` would
 * confirm before a `move_node` commits) — this is a read over an assumed-valid graph, not a
 * validator. Throws on a `parent`-chain cycle rather than recursing unbounded.
 */
export function remaining(nodes: readonly DagNode[], scope: NodeId): DagNode[] {
  assertTreeShapedInput(nodes);

  const childrenByParent = groupChildrenByParent(nodes);
  const doneMemo = new Map<NodeId, boolean>();

  function isFullyDone(node: DagNode): boolean {
    const cached = doneMemo.get(node.id);
    if (cached !== undefined) return cached;
    const children = childrenByParent.get(node.id) ?? [];
    const result = children.length === 0 ? node.status === 'done' : children.every(isFullyDone);
    doneMemo.set(node.id, result);
    return result;
  }

  return nodes.filter((node) => node.parent === scope && !isFullyDone(node));
}
