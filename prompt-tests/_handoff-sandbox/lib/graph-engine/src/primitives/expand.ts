import type { NodeId, DagNode } from '../model/node.js';
import type { DagEdge } from '../model/edge.js';
import type { NodeTypeName } from '../model/vocab.js';
import type { ChangeDelta, NodeChange, EdgeChange } from '../model/delta.js';
import type { Result } from '../result.js';
import type { GraphSnapshot } from '../derive/invariants.js';
import { detectCycle, isTreeShaped } from '../derive/invariants.js';
import type { NodeTypeRegistry } from '../node-type/registry.js';
import type { PrimitiveContext } from './primitive.js';
import { fail, findNode, runPrimitive } from './primitive.js';

/**
 * One node to materialize as part of an `expand` batch. `key` is a handle scoped to this one
 * batch — never persisted — that lets `parent`/`dependsOn` on another spec in the same batch
 * reference a node the batch itself is still creating. Once resolved, `key` doubles as the new
 * node's actual `NodeId` (mirroring `add_node`, where the caller supplies the fresh id directly),
 * so a spec's `key` must be unique within the batch and fresh against the current graph, exactly
 * like any other node id.
 */
export interface NodeSpec {
  readonly key: string;
  readonly type: NodeTypeName;
  /** An intra-batch `key` (another spec in the same `Expansion`) or a pre-existing `NodeId`; `null` for a batch root with no container. */
  readonly parent: string | NodeId | null;
  /** Each entry is resolved independently — an intra-batch `key` or a pre-existing `NodeId` — so a spec can gate on a sibling being created in the same batch and a node that already exists. */
  readonly dependsOn: readonly (string | NodeId)[];
  readonly order?: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** A batch of `NodeSpec`s to materialize as one `expand` delta. */
export interface Expansion {
  readonly specs: readonly NodeSpec[];
}

/** Resolves a `parent`/`dependsOn` reference: an intra-batch key, a pre-existing node, or a structured failure if neither. */
function resolveRef(ref: string, batchKeys: ReadonlySet<string>, graph: GraphSnapshot): Result<NodeId> {
  if (batchKeys.has(ref)) return { ok: true, data: ref };
  if (findNode(graph, ref)) return { ok: true, data: ref };
  return fail('invalid_delta', `expansion references '${ref}', which is neither a batch key nor an existing node`);
}

/**
 * Orders `specs` so a spec whose `parent` is another spec's `key` always follows that spec —
 * containment-topological order, Kahn's-algorithm style. A spec whose `parent` is `null` or not
 * one of the batch's own keys (a pre-existing `NodeId`, or a plain miss caught later by
 * `resolveRef`) has no batch-local prerequisite and is ready immediately. Returns a structured
 * `cycle` failure for a chain of batch-local `parent` keys that never bottoms out — such a chain
 * would otherwise wait forever for a prerequisite that can never resolve.
 */
function orderByContainment(specs: readonly NodeSpec[]): Result<NodeSpec[]> {
  const remaining = new Map(specs.map((spec) => [spec.key, spec]));
  const ordered: NodeSpec[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((spec) => spec.parent === null || !remaining.has(spec.parent));
    if (ready.length === 0) {
      return fail(
        'cycle',
        `expansion has a containment cycle among batch keys: ${[...remaining.keys()].join(', ')}`,
      );
    }
    for (const spec of ready) {
      ordered.push(spec);
      remaining.delete(spec.key);
    }
  }

  return { ok: true, data: ordered };
}

/**
 * The pure resolution/wiring `expand` runs to turn `expansion` into the `ChangeDelta` it would
 * commit — factored out of `expand` so P02's `validate`/`preview` read the exact same computation
 * rather than a second copy. Every spec's `type` resolves against the injected `registry` before
 * anything else is checked — one unregistered spec fails the whole batch with `unknown_node_type`.
 * Every spec's `key` resolves to its new node's `NodeId`; `parent`/`dependsOn` each resolve to
 * either another spec in the same batch (by `key`) or a node already in the graph (by `NodeId`),
 * so a seeded subgraph can gate behind a pre-existing node (e.g. an `approval` gate) in the same
 * batch that creates it. `derivedFrom` is stamped to `node` (the expanding node) on every new node.
 *
 * Rejects on: the expanding node not existing; any spec's `type` not resolving against `registry`;
 * a duplicate or pre-existing-colliding batch `key`; a spec's `parent`/`dependsOn` resolving to
 * neither a batch key nor an existing node; a containment cycle among batch keys; or a
 * `depends_on` cycle/broken tree shape the resolved batch would introduce.
 */
export function computeExpansion(
  graph: GraphSnapshot,
  registry: NodeTypeRegistry,
  node: NodeId,
  expansion: Expansion,
): Result<ChangeDelta> {
  if (!findNode(graph, node)) return fail('invalid_delta', `node '${node}' does not exist`);
  if (expansion.specs.length === 0) return fail('invalid_delta', 'expansion has no specs');

  for (const spec of expansion.specs) {
    if (!registry.resolve(spec.type)) {
      return fail('unknown_node_type', `node type '${spec.type}' is not registered`);
    }
  }

  const batchKeys = new Set<string>();
  for (const spec of expansion.specs) {
    if (batchKeys.has(spec.key)) return fail('invalid_delta', `duplicate batch key '${spec.key}'`);
    if (findNode(graph, spec.key)) {
      return fail('invalid_delta', `batch key '${spec.key}' collides with an existing node id`);
    }
    batchKeys.add(spec.key);
  }

  const ordered = orderByContainment(expansion.specs);
  if (!ordered.ok) return ordered;

  const nodeChanges: NodeChange[] = [];
  const edgeChanges: EdgeChange[] = [];

  for (const spec of ordered.data) {
    let parent: NodeId | null = null;
    if (spec.parent !== null) {
      const resolvedParent = resolveRef(spec.parent, batchKeys, graph);
      if (!resolvedParent.ok) return resolvedParent;
      parent = resolvedParent.data;
    }

    const after: DagNode = {
      id: spec.key,
      type: spec.type,
      status: 'not_started',
      parent,
      order: spec.order ?? 0,
      derivedFrom: node,
      data: spec.data ?? {},
    };
    nodeChanges.push({ op: 'created', before: null, after });

    for (const dep of new Set(spec.dependsOn)) {
      const resolvedDep = resolveRef(dep, batchKeys, graph);
      if (!resolvedDep.ok) return resolvedDep;
      const edge: DagEdge = { from: resolvedDep.data, to: spec.key, kind: 'depends_on' };
      edgeChanges.push({ op: 'created', before: null, after: edge });
    }
  }

  const projectedNodes = [...graph.nodes, ...nodeChanges.map((change) => change.after as DagNode)];
  const projectedEdges = [...graph.edges, ...edgeChanges.map((change) => change.after as DagEdge)];

  const cyclePath = detectCycle(projectedEdges);
  if (cyclePath) return fail('cycle', `expansion would create a depends_on cycle: ${cyclePath.join(' -> ')}`);
  if (!isTreeShaped(projectedNodes)) return fail('invalid_delta', 'expansion would break containment tree shape');

  return {
    ok: true,
    data: {
      primitive: 'expand',
      params: { node, expansion },
      nodeChanges,
      edgeChanges,
    },
  };
}

/**
 * Materializes `expansion` as new nodes and edges under `node` in one delta — the batch a
 * template-compile needs to seed a subgraph atomically. See {@link computeExpansion} for the
 * resolution/rejection rules this runs; `expand` itself only adds the store commit around it.
 *
 * `expand` only wires edges *into* the new nodes — re-pointing an already-existing node onto the
 * new subgraph (e.g. a placeholder's dependent moving onto the freshly expanded work) is the
 * caller's job, issued via `add_dependency`/`remove_dependency` alongside `expand` in the same
 * seeding transition.
 */
export function expand(
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  node: NodeId,
  expansion: Expansion,
): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => computeExpansion(graph, registry, node, expansion));
}
