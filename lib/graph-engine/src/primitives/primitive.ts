import type { NodeId, DagNode } from '../model/node.js';
import type { ChangeDelta } from '../model/delta.js';
import type { Result, EngineErrorCode } from '../result.js';
import type { GraphSnapshot } from '../derive/invariants.js';
import type { ProjectScope, StateStore } from '../store/state-store.js';

/**
 * Everything a mutation primitive needs to read the current graph and commit a `ChangeDelta`
 * against it — the one thing every primitive in `crud.ts`/`lifecycle.ts` takes as its first
 * argument, so a caller never juggles a store and a scope as two loose parameters.
 */
export interface PrimitiveContext {
  readonly store: StateStore;
  readonly scope: ProjectScope;
}

function readGraph(ctx: PrimitiveContext): GraphSnapshot {
  return { nodes: ctx.store.listNodes(ctx.scope), edges: ctx.store.listEdges(ctx.scope) };
}

/** Looks up a node by id in a `GraphSnapshot` — the lookup every primitive needs before it can act on a node. */
export function findNode(graph: GraphSnapshot, id: NodeId): DagNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

/** A structured `Result` failure, generic over the success payload so it drops into any primitive's return type. */
export function fail<T>(code: EngineErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

/**
 * The shared shape every mutation primitive runs through: read the current graph, hand it to
 * `build` — which runs the relevant P02 `validate` and, only on success, assembles a
 * `ChangeDelta` — then commit that delta through the single `store.apply` write path. A `build`
 * that returns an error short-circuits before any write, so a rejected mutation never touches the
 * store; a `build` that succeeds but whose delta `store.apply` itself rejects (e.g. a dangling
 * edge) surfaces that rejection too, still with nothing written — `apply` is transactional.
 */
export function runPrimitive(
  ctx: PrimitiveContext,
  build: (graph: GraphSnapshot) => Result<ChangeDelta>,
): Result<ChangeDelta> {
  const built = build(readGraph(ctx));
  if (!built.ok) return built;

  const applied = ctx.store.apply(ctx.scope, built.data);
  if (!applied.ok) return applied;

  return built;
}
