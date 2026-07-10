// graph-service/src/driver/frontier.ts
//
// `readFrontier`/`isQuiescent` are scoped to one container; a driver walks the whole tree by
// union-ing that same public read over every container currently in the graph (the root, plus any
// node that is some other node's `parent`) — never a second, competing readiness derivation. A
// `phase` container never appears in its own frontier, so a single-scope loop drives nothing
// nested; this is why the driver runs off `globalFrontier`, never `readFrontier` alone. Ported
// from `lib/graph-node-types/tests/harness/test-driver.ts` — same functions, same names.
import type { DagNode, NodeId, PrimitiveContext } from '@rad-orchestration/graph-engine';
import { readFrontier } from '@rad-orchestration/graph-engine';

function containerIds(nodes: readonly DagNode[]): NodeId[] {
  const ids = new Set<NodeId>();
  for (const node of nodes) if (node.parent !== null) ids.add(node.parent);
  return [...ids];
}

export function globalFrontier(ctx: PrimitiveContext, root: NodeId): readonly DagNode[] {
  const nodes = ctx.store.listNodes(ctx.scope);
  const containers = new Set<NodeId>([root, ...containerIds(nodes)]);
  const seen = new Set<NodeId>();
  const result: DagNode[] = [];
  for (const containerId of containers) {
    for (const candidate of readFrontier(ctx, containerId)) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      result.push(candidate);
    }
  }
  return result;
}

export function isGloballyQuiescent(ctx: PrimitiveContext, root: NodeId): boolean {
  return globalFrontier(ctx, root).length === 0;
}
