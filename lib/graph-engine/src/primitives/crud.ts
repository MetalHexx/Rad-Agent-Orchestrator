import type { NodeId, DagNode } from '../model/node.js';
import type { DagEdge } from '../model/edge.js';
import type { NodeTypeName } from '../model/vocab.js';
import type { ChangeDelta, NodeChange, EdgeChange } from '../model/delta.js';
import type { Result } from '../result.js';
import { validate, descendantCone, dependentsCascadeCone } from '../derive/dry-run.js';
import type { PrimitiveContext } from './primitive.js';
import { fail, findNode, runPrimitive } from './primitive.js';

// ── add_node ─────────────────────────────────────────────────────────────────────

export interface AddNodeOptions {
  readonly order?: number;
  readonly data?: Readonly<Record<string, unknown>>;
  /** Existing node ids the new node gates on — lands as `depends_on` edges in the same delta as the node. */
  readonly dependsOn?: readonly NodeId[];
}

/**
 * Inserts a leaf node of `type` under `parent`. Registry resolution of `type` arrives in P04;
 * this primitive only checks structural legality (the parent exists, `id` is fresh — `id` is
 * reserved-safe for free since the seeded root already occupies `ROOT_NODE_ID`, so a caller can
 * never mint a duplicate of it). `dependsOn` lands the node and its gate edges (one `depends_on`
 * edge from each dependency to the new node) in the same delta, so there is never a tick where
 * the node exists but isn't yet gated — no frontier race.
 */
export function add_node(
  ctx: PrimitiveContext,
  id: NodeId,
  type: NodeTypeName,
  parent: NodeId,
  options: AddNodeOptions = {},
): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    if (findNode(graph, id)) return fail('invalid_delta', `node '${id}' already exists`);
    if (!findNode(graph, parent)) return fail('invalid_delta', `parent '${parent}' does not exist`);

    const dependsOn = [...new Set(options.dependsOn ?? [])];
    for (const depId of dependsOn) {
      if (!findNode(graph, depId)) {
        return fail('invalid_delta', `dependsOn references node '${depId}', which does not exist`);
      }
    }

    const node: DagNode = {
      id,
      type,
      status: 'not_started',
      parent,
      order: options.order ?? 0,
      derivedFrom: null,
      data: options.data ?? {},
    };

    const nodeChanges: NodeChange[] = [{ op: 'created', before: null, after: node }];
    // A cycle is structurally impossible here: `id` is fresh, so nothing in the current graph can
    // already point at it, and every gate edge this delta adds only ever points *into* `id`.
    const edgeChanges: EdgeChange[] = dependsOn.map((depId) => {
      const edge: DagEdge = { from: depId, to: id, kind: 'depends_on' };
      return { op: 'created', before: null, after: edge };
    });

    return {
      ok: true,
      data: {
        primitive: 'add_node',
        params: { id, type, parent, order: node.order, dependsOn },
        nodeChanges,
        edgeChanges,
      },
    };
  });
}

// ── remove_node ──────────────────────────────────────────────────────────────────

export type ChildRemovalStrategy = 'cascade' | 'promote';
export type DependentRemovalStrategy = 'heal' | 'cascade' | 'detach';

export interface RemoveNodeStrategy {
  /** How the removed node's containment children are handled. Defaults to `'cascade'`. */
  readonly children?: ChildRemovalStrategy;
  /** How nodes that `depends_on` the removed node are handled. */
  readonly dependents: DependentRemovalStrategy;
}

/** Every direct child of `parentId`, via `DagNode.parent` — never recurses. */
function directChildren(nodes: readonly DagNode[], parentId: NodeId): DagNode[] {
  return nodes.filter((node) => node.parent === parentId);
}

/**
 * Removes `node` (root-guarded). `strategy.children` governs the containment axis: `'cascade'`
 * (default) removes every descendant along with `node`; `'promote'` removes only `node` and
 * re-parents its direct children onto `node`'s own parent. `strategy.dependents` governs the
 * `depends_on` axis for `node`'s own direct edges: `'heal'` splices every dependent straight onto
 * every dependency — the conservative full cross-product, so no real ordering is ever silently
 * dropped; `'cascade'` transitively removes everything gated on `node` (its gate is gone for
 * good), pulling in each swept node's own containment descendants so nothing is left pointing at
 * a deleted parent (never the root, which stays guarded even mid-sweep); `'detach'` just drops the
 * edges. Every other edge incident to a removed node (e.g. a cascaded descendant's own external
 * edge) is dropped outright regardless of `dependents` — healing is scoped to `node`'s own direct
 * edges, not projected through the whole removed subtree. Both destructive axes (`children:
 * 'cascade'` and `dependents: 'cascade'`) are preview-able ahead of the commit via P02's `preview`,
 * which shares the exact same `descendantCone`/`dependentsCascadeCone` walk this primitive commits.
 */
export function remove_node(
  ctx: PrimitiveContext,
  node: NodeId,
  strategy: RemoveNodeStrategy,
): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const target = findNode(graph, node);
    if (!target) return fail('invalid_delta', `node '${node}' does not exist`);

    const childrenStrategy = strategy.children ?? 'cascade';
    const dependentsCascade = strategy.dependents === 'cascade';

    const validated = validate(graph, {
      kind: 'remove_node',
      nodeId: node,
      cascade: childrenStrategy === 'cascade',
      dependentsCascade,
    });
    if (!validated.ok) return validated;

    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
    const containmentIds = childrenStrategy === 'cascade' ? descendantCone(graph.nodes, node) : [node];
    const removal = new Set<NodeId>(
      dependentsCascade ? dependentsCascadeCone(graph, containmentIds) : containmentIds,
    );

    const incidentEdges = graph.edges.filter(
      (edge) => edge.kind === 'depends_on' && (removal.has(edge.from) || removal.has(edge.to)),
    );
    const edgeChanges: EdgeChange[] = incidentEdges.map((edge) => ({ op: 'removed', before: edge, after: null }));

    if (strategy.dependents === 'heal') {
      const dependencies = incidentEdges
        .filter((edge) => edge.to === node && !removal.has(edge.from))
        .map((edge) => edge.from);
      const dependents = incidentEdges
        .filter((edge) => edge.from === node && !removal.has(edge.to))
        .map((edge) => edge.to);

      const existing = new Set(graph.edges.map((edge) => `${edge.from}->${edge.to}`));
      const planned = new Set<string>();
      for (const from of dependencies) {
        for (const to of dependents) {
          if (from === to) continue;
          const key = `${from}->${to}`;
          if (existing.has(key) || planned.has(key)) continue;
          planned.add(key);
          const healedEdge: DagEdge = { from, to, kind: 'depends_on' };
          edgeChanges.push({ op: 'created', before: null, after: healedEdge });
        }
      }
    }

    const nodeChanges: NodeChange[] = [...removal].flatMap((id) => {
      const before = nodesById.get(id);
      return before ? [{ op: 'removed' as const, before, after: null }] : [];
    });

    if (childrenStrategy === 'promote') {
      for (const child of directChildren(graph.nodes, node)) {
        nodeChanges.push({ op: 'updated', before: child, after: { ...child, parent: target.parent } });
      }
    }

    return {
      ok: true,
      data: {
        primitive: 'remove_node',
        params: { node, strategy },
        nodeChanges,
        edgeChanges,
      },
    };
  });
}

// ── add_dependency / remove_dependency ──────────────────────────────────────────

/** Adds a `depends_on` edge from `from` to `to` (`to` gates on `from`). Rejects a cycle via P02's `validate`. */
export function add_dependency(ctx: PrimitiveContext, from: NodeId, to: NodeId): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    if (!findNode(graph, from)) return fail('invalid_delta', `node '${from}' does not exist`);
    if (!findNode(graph, to)) return fail('invalid_delta', `node '${to}' does not exist`);

    const validated = validate(graph, { kind: 'add_dependency', from, to });
    if (!validated.ok) return validated;

    const edge: DagEdge = { from, to, kind: 'depends_on' };
    return {
      ok: true,
      data: {
        primitive: 'add_dependency',
        params: { from, to },
        nodeChanges: [],
        edgeChanges: [{ op: 'created', before: null, after: edge }],
      },
    };
  });
}

/** Removes the `depends_on` edge from `from` to `to`. Removing an edge can never create a cycle, so there is no P02 check to run. */
export function remove_dependency(ctx: PrimitiveContext, from: NodeId, to: NodeId): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const edge = graph.edges.find((e) => e.kind === 'depends_on' && e.from === from && e.to === to);
    if (!edge) return fail('invalid_delta', `edge '${from}' -> '${to}' does not exist`);

    return {
      ok: true,
      data: {
        primitive: 'remove_dependency',
        params: { from, to },
        nodeChanges: [],
        edgeChanges: [{ op: 'removed', before: edge, after: null }],
      },
    };
  });
}

// ── move_node / set_order ───────────────────────────────────────────────────────

/** Re-parents `node` under `newParent`. Root-guarded; rejects a containment cycle via P02's `validate`. */
export function move_node(ctx: PrimitiveContext, node: NodeId, newParent: NodeId): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const current = findNode(graph, node);
    if (!current) return fail('invalid_delta', `node '${node}' does not exist`);
    if (!findNode(graph, newParent)) return fail('invalid_delta', `parent '${newParent}' does not exist`);

    const validated = validate(graph, { kind: 'move_node', nodeId: node, newParent });
    if (!validated.ok) return validated;

    const after: DagNode = { ...current, parent: newParent };
    return {
      ok: true,
      data: {
        primitive: 'move_node',
        params: { node, newParent },
        nodeChanges: [{ op: 'updated', before: current, after }],
        edgeChanges: [],
      },
    };
  });
}

/** Reorders `node` among its siblings. Advisory only — never validated against `depends_on` edges. */
export function set_order(ctx: PrimitiveContext, node: NodeId, order: number): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const current = findNode(graph, node);
    if (!current) return fail('invalid_delta', `node '${node}' does not exist`);

    const after: DagNode = { ...current, order };
    return {
      ok: true,
      data: {
        primitive: 'set_order',
        params: { node, order },
        nodeChanges: [{ op: 'updated', before: current, after }],
        edgeChanges: [],
      },
    };
  });
}
