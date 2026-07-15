import type { NodeId, DagNode } from '../model/node.js';
import type { ChangeDelta } from '../model/delta.js';
import type { Result } from '../result.js';
import type { PrimitiveContext } from '../primitives/primitive.js';
import { fail, findNode } from '../primitives/primitive.js';
import { frontier } from '../derive/readiness.js';
import type { GraphSnapshot } from '../derive/invariants.js';
import type { NodeTypeRegistry } from '../node-type/registry.js';
import type { ActContext, ActResult, DataResolver, SpawnPayload } from '../node-type/definition.js';

/**
 * The dispatch channel `ActResult.payload` carries when `executor` is `'spawn-sub-agent'` — the
 * contract a host reads to know what to spawn, and to which agent. `orchestrator-inline`
 * (`master_plan`/`explosion`/`pr`) node types typically carry no payload; when they do, it is
 * side-channel context data (not a spawn request) passed as `Readonly<Record<string, unknown>>`.
 * Their `instructions` are executed in-process by the host instead of dispatched to a sub-agent.
 */
export type DispatchRequest = SpawnPayload;

/**
 * The driver-facing frontier read: every node under `scope` a host may currently `engage`, read
 * straight off `ctx`'s store rather than requiring the host to source `nodes`/`edges` itself.
 * Mirrors `frontier` exactly — see its own doc comment for the eligibility rule and the
 * acyclic/tree-shaped precondition it throws on.
 */
export function readFrontier(ctx: PrimitiveContext, scope: NodeId): readonly DagNode[] {
  return frontier(ctx.store.listNodes(ctx.scope), ctx.store.listEdges(ctx.scope), scope);
}

/**
 * The harness loop's termination condition: nothing under `scope` is eligible to be `engage`d
 * right now. A driver polls this between rounds of `engage`/`apply_event`; once it holds, no
 * further progress is possible under `scope` without an external event (a completion, a resume)
 * the host hasn't yet supplied.
 */
export function isQuiescent(ctx: PrimitiveContext, scope: NodeId): boolean {
  return readFrontier(ctx, scope).length === 0;
}

/**
 * The engine's sole `not_started -> in_progress` writer — the driver contract's other half of
 * `apply_event`. A host drives one node start-to-finish by: reading the frontier, picking a node
 * from it, calling `engage` (this function — the optimistic in-progress write; there is no
 * `*_started` event), performing the returned `ActResult`'s work through its `executor`, then
 * pumping the resulting `<type>.<outcome>` event back via `apply_event`.
 *
 * Rejects, writing nothing: `node` doesn't exist (`invalid_delta`); `node` isn't currently in the
 * frontier under its own `parent` — not `not_started`, disabled, gated on an undone predecessor,
 * or its container not yet entered (`not_in_frontier`); or `node`'s `type` isn't registered
 * (`unknown_node_type`).
 *
 * Deliberately does not route through `runPrimitive`: every other mutation primitive's shape ends
 * at a successful `store.apply`, but `engage` has one more step afterwards — calling the resolved
 * node type's own `act` — so it composes the same read/validate/apply steps directly instead of
 * forcing that extra step through a callback built for a narrower contract.
 *
 * `resolveData`, when supplied, runs against the node's own `data` *before* the in-progress write —
 * a resolution failure (the resolver throws) rejects with `invalid_delta`, writing nothing, so the
 * node stays `not_started` and re-engageable. The resolved data is handed to `act` only; it is
 * never written back to the store — re-derived fresh on every `engage` rather than persisted.
 */
export function engage(
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  node: NodeId,
  resolveData?: DataResolver,
): Result<ActResult> {
  const graph: GraphSnapshot = { nodes: ctx.store.listNodes(ctx.scope), edges: ctx.store.listEdges(ctx.scope) };

  const current = findNode(graph, node);
  if (!current) return fail('invalid_delta', `node '${node}' does not exist`);

  if (current.parent === null) {
    return fail('not_in_frontier', `node '${node}' has no container and is never frontier-eligible`);
  }
  if (!frontier(graph.nodes, graph.edges, current.parent).some((candidate) => candidate.id === node)) {
    return fail('not_in_frontier', `node '${node}' is not in the frontier under its parent '${current.parent}'`);
  }

  const definition = registry.resolve(current.type);
  if (!definition) return fail('unknown_node_type', `node type '${current.type}' is not registered`);

  let actData = current.data;
  if (resolveData) {
    try {
      actData = resolveData(definition.dataSchema, current.data);
    } catch (error) {
      // D24: the host owns resolution; the engine only surfaces its refusal — it never inspects the reason.
      return fail('invalid_delta', `node '${node}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const after: DagNode = { ...current, status: 'in_progress' };
  const delta: ChangeDelta = {
    primitive: 'engage',
    params: { node },
    nodeChanges: [{ op: 'updated', before: current, after }],
    edgeChanges: [],
  };

  const applied = ctx.store.apply(ctx.scope, delta);
  if (!applied.ok) return applied;

  const actContext: ActContext = { nodeId: node, data: actData, nodes: graph.nodes, edges: graph.edges };
  return { ok: true, data: definition.act(actContext) };
}
