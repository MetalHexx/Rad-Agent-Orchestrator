// graph-service/src/driver/drive.ts
//
// The driver loop: engage a frontier node, dispatch its `ActResult` to the resolver registered for
// its type, apply the resulting outcome — one node at a time, to quiescence. Ports are `async`
// (`Promise<Envelope>`); the engine's `engage`/`apply_event`/`expand`/`reset` are synchronous, so
// `advance` engages *before* it ever awaits anything, and commits the outcome only after that
// await settles. Adapted from `lib/graph-node-types/tests/harness/test-driver.ts`'s `runToQuiescence`
// loop, factored into a standalone `advance` step (this package's own contribution — the proven
// harness never separated it) so a single step is independently callable and testable.
import type {
  ActResult,
  DagNode,
  NodeId,
  NodeTypeName,
  NodeTypeRegistry,
  PrimitiveContext,
  Result,
} from '@rad-orchestration/graph-engine';
import { engage } from '@rad-orchestration/graph-engine';
import { globalFrontier } from './frontier.js';

export type NodeOutcomeResolver = (
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  node: DagNode,
  actResult: ActResult,
) => Promise<void> | void;

export interface AdvanceResult {
  readonly nodeId: NodeId;
  readonly type: NodeTypeName;
}

/**
 * One frontier step: `engage`s `node` — the synchronous `not_started -> in_progress` write plus
 * its `act` dispatch — then hands the resulting `ActResult` to the resolver registered for `node`'s
 * own type, which awaits whatever capability port(s) it needs before committing the outcome via
 * `applyOutcome`. `engage` rejecting (e.g. `node` fell out of the frontier between selection and
 * this call) surfaces as a structured `Result` failure here, never a thrown exception, so a caller
 * decides how to react instead of wrapping this in a try/catch. A `node.type` with no registered
 * resolver is a driver bug, not a recoverable outcome — it throws.
 */
export async function advance(
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  resolvers: Readonly<Record<NodeTypeName, NodeOutcomeResolver>>,
  node: DagNode,
): Promise<Result<AdvanceResult>> {
  const engaged = engage(ctx, registry, node.id);
  if (!engaged.ok) return engaged;

  const resolver = resolvers[node.type];
  if (!resolver) throw new Error(`driver: no outcome resolver registered for node type '${node.type}'`);

  await resolver(ctx, registry, node, engaged.data);
  return { ok: true, data: { nodeId: node.id, type: node.type } };
}

export interface QuiescenceSettled {
  readonly settled: true;
  readonly steps: number;
}

export interface QuiescenceNotSettled {
  readonly settled: false;
  readonly steps: number;
  /** Every node still frontier-eligible when the `maxSteps` cap was hit. */
  readonly remaining: readonly NodeId[];
}

export type QuiescenceResult = QuiescenceSettled | QuiescenceNotSettled;

/**
 * Runs {@link advance} to quiescence: read the whole-tree frontier (`globalFrontier`), advance one
 * eligible node, repeat — one node at a time (never a batched round), re-reading the frontier
 * before every single step so a stale candidate is never acted on. `maxSteps` bounds the loop with
 * a structured non-settle result rather than spinning forever. An `advance` rejection (`engage`
 * failing on a node the frontier just certified as eligible) is a driver bug, surfaced as a thrown
 * error rather than folded into the non-settle result.
 */
export async function runToQuiescence(
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  root: NodeId,
  resolvers: Readonly<Record<NodeTypeName, NodeOutcomeResolver>>,
  maxSteps = 300,
): Promise<QuiescenceResult> {
  let steps = 0;
  for (;;) {
    const frontierNow = globalFrontier(ctx, root);
    if (frontierNow.length === 0) return { settled: true, steps };
    if (steps >= maxSteps) return { settled: false, steps, remaining: frontierNow.map((node) => node.id) };

    const next = frontierNow[0];
    const advanced = await advance(ctx, registry, resolvers, next);
    if (!advanced.ok) throw new Error(`driver: engage('${next.id}') failed: ${advanced.error.message}`);
    steps += 1;
  }
}
