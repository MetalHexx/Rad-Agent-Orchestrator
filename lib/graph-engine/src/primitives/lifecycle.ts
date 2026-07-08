import type { NodeId, DagNode } from '../model/node.js';
import type { ChangeDelta } from '../model/delta.js';
import type { Result } from '../result.js';
import type { PrimitiveContext } from './primitive.js';
import { fail, findNode, runPrimitive } from './primitive.js';

/**
 * Flips `node`'s `disabled` flag — the cross-cutting exclude-from-frontier axis, orthogonal to
 * `status`. A disabled node keeps whatever status it holds but is never frontier-eligible.
 */
export function toggle(ctx: PrimitiveContext, node: NodeId): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const current = findNode(graph, node);
    if (!current) return fail('invalid_delta', `node '${node}' does not exist`);

    const after: DagNode = { ...current, disabled: !current.disabled };
    return {
      ok: true,
      data: {
        primitive: 'toggle',
        params: { node, disabled: after.disabled },
        nodeChanges: [{ op: 'updated', before: current, after }],
        edgeChanges: [],
      },
    };
  });
}

/** Returns a halted node to `not_started`, re-entering it into the ordinary frontier lifecycle. */
export function resume(ctx: PrimitiveContext, node: NodeId): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const current = findNode(graph, node);
    if (!current) return fail('invalid_delta', `node '${node}' does not exist`);

    const after: DagNode = { ...current, status: 'not_started' };
    return {
      ok: true,
      data: {
        primitive: 'resume',
        params: { node },
        nodeChanges: [{ op: 'updated', before: current, after }],
        edgeChanges: [],
      },
    };
  });
}
