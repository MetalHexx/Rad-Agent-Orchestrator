// graph-service/src/driver/outcome.ts
//
// Engine glue: applying a resolved outcome exactly the way a real host would. `engage` only ever
// returns the `ActResult` to dispatch; committing whatever comes back from that dispatch — the
// data patch, a routing request, an expansion, and the node's own re-projected status — is the
// host's job. This is that job, factored once so every node type's own `resolve` hook
// (`driver/drive.ts`'s `resolveViaNodeType`) and a relayed real-world completion (`http/
// engine-graph.ts`) share it rather than re-deriving it. Ported from
// `lib/graph-node-types/tests/harness/test-driver.ts` — same functions, same names.
import type {
  DagEdge,
  DagNode,
  NodeEvent,
  NodeId,
  NodeTypeName,
  NodeTypeRegistry,
  PrimitiveContext,
  ResolveOutcome,
  Result,
  RoutingRequest,
} from '@rad-orchestration/graph-engine';
import { add_corrective, apply_event, expand, reset, toggle } from '@rad-orchestration/graph-engine';

/** The service's own name for the engine's `ResolveOutcome` — the shape every resolved node's outcome commits through `applyOutcome`. */
export type DriverOutcome = ResolveOutcome;

/** `review`'s current chain tip — the predecessor no sibling predecessor names as its own `derivedFrom` — mirroring the engine's own internal `add_corrective` tip walk, kept host-side since routing carries no store access of its own. */
function findChainTip(nodes: readonly DagNode[], edges: readonly DagEdge[], review: NodeId): DagNode | undefined {
  const predecessorIds = edges.filter((edge) => edge.kind === 'depends_on' && edge.to === review).map((edge) => edge.from);
  const predecessors = predecessorIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is DagNode => node !== undefined);
  const predecessorIdSet = new Set(predecessors.map((node) => node.id));
  const referencedAsDerivedFrom = new Set(
    predecessors.map((node) => node.derivedFrom).filter((id): id is NodeId => id !== null && predecessorIdSet.has(id)),
  );
  return predecessors.find((node) => !referencedAsDerivedFrom.has(node.id)) ?? predecessors[predecessors.length - 1];
}

/**
 * Carries out one `HandleResult.routing` request. Only the three primitives the shipped built-ins'
 * own `handle` ever requests are supported (`reset`, `add_corrective`, `toggle`) — any other is a
 * driver bug, not a silently-ignored no-op. `add_corrective`'s
 * own `handle`-supplied `params.data` deliberately carries only `reviewReportPath`/`correctiveIndex`
 * (see `code-review.ts`); the chain's original scope contract (`handoffDocPath`/`repos`/`complexity`/
 * `shouldCommit`) is carried
 * forward here from the review's current chain tip — the same host-side enrichment a real
 * orchestrator performs before minting a corrective, never invented by the engine's own compound
 * primitive.
 */
function runRouting(ctx: PrimitiveContext, registry: NodeTypeRegistry, routing: RoutingRequest): Result<unknown> {
  switch (routing.primitive) {
    case 'reset': {
      const params = routing.params as unknown as { node: NodeId; cascade?: boolean };
      return reset(ctx, params.node, params.cascade ?? false);
    }
    case 'add_corrective': {
      const params = routing.params as unknown as {
        id: NodeId;
        type: NodeTypeName;
        review: NodeId;
        data?: Readonly<Record<string, unknown>>;
      };
      const tip = findChainTip(ctx.store.listNodes(ctx.scope), ctx.store.listEdges(ctx.scope), params.review);
      const carriedForward = tip
        ? {
            handoffDocPath: tip.data.handoffDocPath,
            repos: tip.data.repos,
            complexity: tip.data.complexity,
            shouldCommit: tip.data.shouldCommit,
          }
        : {};
      return add_corrective(ctx, params.id, params.type, params.review, {
        data: { ...carriedForward, ...params.data },
      });
    }
    case 'toggle': {
      const params = routing.params as unknown as { node: NodeId };
      return toggle(ctx, params.node);
    }
    default:
      throw new Error(`driver: unsupported routing primitive '${routing.primitive}'`);
  }
}

/** Re-projects `nodeId`'s status via its resolved `NodeTypeDefinition.projectStatus`, writing the change only if it actually moved — the host-side half of the contract `apply_event` deliberately leaves undone (it only ever touches `data`). */
function syncProjectedStatus(ctx: PrimitiveContext, registry: NodeTypeRegistry, nodeId: NodeId): void {
  const node = ctx.store.getNode(ctx.scope, nodeId);
  if (!node) return;
  const definition = registry.resolve(node.type);
  if (!definition) return;

  const projected = definition.projectStatus(node.data);
  if (projected === node.status) return;

  const after: DagNode = { ...node, status: projected };
  const applied = ctx.store.apply(ctx.scope, {
    primitive: 'apply_event',
    params: { node: nodeId, projectedStatus: projected },
    nodeChanges: [{ op: 'updated', before: node, after }],
    edgeChanges: [],
  });
  if (!applied.ok) throw new Error(`driver: status sync failed for '${nodeId}': ${applied.error.message}`);
}

/** Commits one dispatched outcome: the node type's own `handle` reaction (data patch, routing, expansion), then the resulting status re-projection — the full "apply_event the outcome" step every resolver ends with. */
export function applyOutcome(ctx: PrimitiveContext, registry: NodeTypeRegistry, nodeId: NodeId, outcome: DriverOutcome): void {
  const node = ctx.store.getNode(ctx.scope, nodeId);
  if (!node) throw new Error(`driver: node '${nodeId}' does not exist`);
  const definition = registry.resolve(node.type);
  if (!definition) throw new Error(`driver: node type '${node.type}' is not registered`);

  const ev: NodeEvent = { token: outcome.token, nodeId, envelope: outcome.envelope };
  const handled = definition.handle(ev);

  const applied = apply_event(ctx, nodeId, outcome.token, () => handled.dataChange ?? null);
  if (!applied.ok) throw new Error(`driver: apply_event('${nodeId}') failed: ${applied.error.message}`);

  if (handled.routing) {
    const routed = runRouting(ctx, registry, handled.routing);
    if (!routed.ok) throw new Error(`driver: routing '${handled.routing.primitive}' failed: ${routed.error.message}`);
  }

  if (handled.expansion) {
    const expanded = expand(ctx, registry, nodeId, handled.expansion);
    if (!expanded.ok) throw new Error(`driver: expansion from '${nodeId}' failed: ${expanded.error.message}`);
  }

  syncProjectedStatus(ctx, registry, nodeId);
}
