import type { NodeId, DagNode } from '../model/node.js';
import type { EventToken } from '../model/vocab.js';
import type { ChangeDelta, NodeChange } from '../model/delta.js';
import type { Result } from '../result.js';
import type { PrimitiveContext } from './primitive.js';
import { fail, findNode, runPrimitive } from './primitive.js';

/**
 * The node-type-owned reaction to an event: given the node `event` was routed to, returns the
 * `data` patch to merge onto it, or `null` when the event carries no node-type-relevant reaction.
 * This is the seam `apply_event` routes through — a later phase resolves the real handler for a
 * node's type via a registry; this primitive takes one directly, as a caller-supplied callback.
 */
export type EventHandler = (node: DagNode, event: EventToken) => Readonly<Record<string, unknown>> | null;

/**
 * Routes `event` to `node`: looks the node up, hands it and `event` to `handler`, then commits any
 * resulting `data` patch as a single-node `updated` delta. `handler` returning `null` means no
 * reaction — `apply_event` still succeeds, with an empty delta, so a caller never has to
 * special-case "no-op" as a failure.
 */
export function apply_event(
  ctx: PrimitiveContext,
  node: NodeId,
  event: EventToken,
  handler: EventHandler,
): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const current = findNode(graph, node);
    if (!current) return fail('invalid_delta', `node '${node}' does not exist`);

    const patch = handler(current, event);
    const nodeChanges: NodeChange[] = [];
    if (patch !== null) {
      const after: DagNode = { ...current, data: { ...current.data, ...patch } };
      nodeChanges.push({ op: 'updated', before: current, after });
    }

    return {
      ok: true,
      data: {
        primitive: 'apply_event',
        params: { node, event },
        nodeChanges,
        edgeChanges: [],
      },
    };
  });
}
