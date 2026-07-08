import type { NodeId, DagNode } from '../model/node.js';
import type { NodeStatus } from '../model/vocab.js';
import type { ChangeDelta } from '../model/delta.js';
import type { Result } from '../result.js';
import type { PrimitiveContext } from './primitive.js';
import { fail, findNode, runPrimitive } from './primitive.js';

/** The two halted statuses `resume` re-arms — anything else (an unrun, running, or done node) has its own primitive (`reset`) for that axis. */
const RESUMABLE_STATUSES: readonly NodeStatus[] = ['blocked', 'failed'];

function isResumable(status: NodeStatus): boolean {
  return RESUMABLE_STATUSES.includes(status);
}

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

/**
 * Returns a halted (`blocked`/`failed`) node to `not_started`, re-entering it into the ordinary
 * frontier lifecycle. Rejects any other status — a node that hasn't run yet, is running, or is
 * `done` was never halted, so there is nothing for `resume` to lift; `done`/`in_progress` re-arming
 * is `reset`'s axis instead, whose `cascade` also tears down whatever a `done` node previously
 * `expand`ed, which `resume` deliberately has no path to bypass.
 */
export function resume(ctx: PrimitiveContext, node: NodeId): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const current = findNode(graph, node);
    if (!current) return fail('invalid_delta', `node '${node}' does not exist`);
    if (!isResumable(current.status)) {
      return fail(
        'invalid_delta',
        `node '${node}' has status '${current.status}'; resume only re-arms 'blocked'/'failed' nodes`,
      );
    }

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
