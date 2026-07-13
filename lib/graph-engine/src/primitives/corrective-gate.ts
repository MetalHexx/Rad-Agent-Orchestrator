import type { NodeId, DagNode } from '../model/node.js';
import type { DagEdge } from '../model/edge.js';
import type { NodeTypeName } from '../model/vocab.js';
import type { ChangeDelta, NodeChange } from '../model/delta.js';
import type { Result } from '../result.js';
import type { GraphSnapshot } from '../derive/invariants.js';
import { validate } from '../derive/dry-run.js';
import type { PrimitiveContext } from './primitive.js';
import { fail, findNode, runPrimitive } from './primitive.js';

export interface AddCorrectiveGateOptions {
  readonly order?: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * The effect set a prospective `add_corrective_gate(id, type, source, gate, options)` call would
 * produce — the corrective node + gate edge it would create. Factored out of `add_corrective_gate`
 * mirroring `computeAddCorrective`'s own split, so a future `preview` reads the exact same
 * computation rather than a second copy.
 */
export interface AddCorrectiveGateComputation {
  readonly correctiveNode: DagNode;
  /** The `corrective -> gate` depends_on edge. */
  readonly gateEdge: DagEdge;
  readonly delta: ChangeDelta;
}

/**
 * Computes: a corrective node — parented alongside `source` (the node whose outcome is being
 * corrected, e.g. an audit that reported issues), `derivedFrom` `source` — plus the `depends_on`
 * edge gating `gate` (a downstream node that has not yet run) on that corrective. Rejects `gate`
 * already `done`/`in_progress`: those have already run, so a gate edge landing now could never have
 * held them back — the same "too late to matter" rejection shape `computeAddCorrective` gives a
 * `review` that hasn't run yet, mirrored onto this primitive's opposite precondition.
 *
 * Deliberately never touches `source` or `gate`'s own status: unlike `add_corrective` (which resets
 * the review it re-arms, forcing it to run again), this only ever adds a new predecessor onto `gate`
 * — `source` is never reset, so it never re-enters the frontier, and `gate` stays exactly as
 * `not_started` as it already was, simply with one more predecessor `frontier` now requires done.
 */
export function computeAddCorrectiveGate(
  graph: GraphSnapshot,
  id: NodeId,
  type: NodeTypeName,
  source: NodeId,
  gate: NodeId,
  options: AddCorrectiveGateOptions = {},
): Result<AddCorrectiveGateComputation> {
  const sourceNode = findNode(graph, source);
  if (!sourceNode) return fail('invalid_delta', `source '${source}' does not exist`);
  if (sourceNode.parent === null) {
    return fail('invalid_delta', `'${source}' has no container to parent a corrective under`);
  }

  const gateNode = findNode(graph, gate);
  if (!gateNode) return fail('invalid_delta', `gate '${gate}' does not exist`);
  if (gateNode.status === 'done' || gateNode.status === 'in_progress') {
    return fail(
      'invalid_delta',
      `gate '${gate}' has status '${gateNode.status}'; add_corrective_gate only holds a node that has not yet run`,
    );
  }

  if (findNode(graph, id)) return fail('invalid_delta', `node '${id}' already exists`);

  const corrective: DagNode = {
    id,
    type,
    status: 'not_started',
    parent: sourceNode.parent,
    order: options.order ?? 0,
    derivedFrom: source,
    data: options.data ?? {},
  };

  const edge: DagEdge = { from: id, to: gate, kind: 'depends_on' };
  const validated = validate(graph, { kind: 'add_dependency', from: id, to: gate });
  if (!validated.ok) return validated;

  const nodeChanges: NodeChange[] = [{ op: 'created', before: null, after: corrective }];

  return {
    ok: true,
    data: {
      correctiveNode: corrective,
      gateEdge: edge,
      delta: {
        primitive: 'add_corrective_gate',
        params: { id, type, source, gate },
        nodeChanges,
        edgeChanges: [{ op: 'created', before: null, after: edge }],
      },
    },
  };
}

/**
 * The audit-correction compound primitive: births a corrective attempt answering `source`'s
 * reported outcome and gates `gate` — a downstream node that depends (directly or transitively) on
 * `source` but has not yet run — on that corrective, all in one delta. `id`/`type` name the new
 * corrective node exactly like `add_node`/`add_corrective` would.
 *
 * This is the primitive that makes "correct and re-explode without re-auditing" expressible:
 * `add_corrective` cannot gate a downstream node this way because it always resets *and requires
 * already-run status on* the node it gates (see {@link computeAddCorrective} in `corrective.ts`) —
 * exactly the re-audit `add_corrective_gate` avoids by never touching `source` or resetting `gate`.
 * See {@link computeAddCorrectiveGate} for exactly what this commits and the precondition it rejects.
 *
 * **Routing contract** (what a `RoutingRequest` names to invoke this):
 * `{ primitive: 'add_corrective_gate', params: { id, type, source, gate, options? } }`.
 */
export function add_corrective_gate(
  ctx: PrimitiveContext,
  id: NodeId,
  type: NodeTypeName,
  source: NodeId,
  gate: NodeId,
  options: AddCorrectiveGateOptions = {},
): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const computed = computeAddCorrectiveGate(graph, id, type, source, gate, options);
    if (!computed.ok) return computed;
    return { ok: true, data: computed.data.delta };
  });
}
