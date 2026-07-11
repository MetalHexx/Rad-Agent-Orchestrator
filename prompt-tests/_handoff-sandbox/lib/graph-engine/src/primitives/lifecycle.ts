import type { NodeId, DagNode } from '../model/node.js';
import type { NodeStatus } from '../model/vocab.js';
import type { ChangeDelta } from '../model/delta.js';
import type { Result } from '../result.js';
import type { PrimitiveContext } from './primitive.js';
import { fail, findNode, runPrimitive } from './primitive.js';
import { resolveChainTip } from './corrective.js';

/** The two rejected-halt statuses `resume` re-arms via status alone — anything else (an unrun, running, or done node) has its own primitive (`reset`) for that axis. `disabled` is `resume`'s other, orthogonal halt axis (see {@link resume}). */
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
 * Undoes any halt on `node` — the single, uniform "resume" primitive over both halt axes the
 * engine recognizes: a rejected halt (`status` `blocked`/`failed`, mapped back to `not_started`)
 * and an exclusion halt (`disabled: true`, cleared regardless of `status`; an already-idle
 * `not_started` status is left as-is, since clearing `disabled` alone re-admits it to the
 * frontier). Rejects a node that is neither — one that hasn't run yet, is running, or is `done`
 * was never halted, so there is nothing for `resume` to lift; `done`/`in_progress` re-arming is
 * `reset`'s axis instead, whose `cascade` also tears down whatever a `done` node previously
 * `expand`ed, which `resume` deliberately has no path to bypass.
 *
 * When clearing a set `disabled` flag, `resume` also stamps `budgetAnchor` at
 * `resolveChainTip(node)`'s tip, if that call returns non-null — the same tip-resolution
 * `add_corrective` itself uses, never a parallel computation. This is deliberately
 * engine-observable rather than type-aware (the core never switches on `type`, and both a
 * corrective-budget halt and an explosion halt land in the identical `disabled: true` shape): it
 * scopes anchoring to disabled halts with a resolvable chain and excludes the `blocked`
 * rejected-halt (never `disabled`) and a plain disabled leaf with no chain (`resolveChainTip`
 * returns `null`). A resumed explosion incidentally receives an anchor too (its `master_plan`
 * predecessor gives it a non-null chain tip) — harmless, since `add_corrective` never targets an
 * explosion and so never reads it.
 */
export function resume(ctx: PrimitiveContext, node: NodeId): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const current = findNode(graph, node);
    if (!current) return fail('invalid_delta', `node '${node}' does not exist`);

    const wasDisabled = current.disabled === true;
    if (!wasDisabled && !isResumable(current.status)) {
      return fail(
        'invalid_delta',
        `node '${node}' has status '${current.status}'; resume only re-arms 'blocked'/'failed' or disabled nodes`,
      );
    }

    const after: DagNode = { ...current };
    if (isResumable(current.status)) after.status = 'not_started';
    if (wasDisabled) {
      after.disabled = false;
      const chain = resolveChainTip(graph, node);
      if (chain) after.budgetAnchor = chain.tip.id;
    }

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
