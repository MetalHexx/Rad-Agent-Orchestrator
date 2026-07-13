// graph-service/src/driver/drive.ts
//
// The driver loop: engage a frontier node, dispatch its `ActResult` to the resolver registered for
// its type, apply the resulting outcome — one node at a time. Ports are `async` (`Promise<Envelope>`);
// the engine's `engage`/`apply_event`/`expand`/`reset` are synchronous, so `advance` engages *before*
// it ever awaits anything, and commits the outcome only after that await settles. Adapted from
// `lib/graph-node-types/tests/harness/test-driver.ts`'s `runToQuiescence` loop, factored into a
// standalone `advance` step (this package's own contribution — the proven harness never separated
// it) so a single step is independently callable and testable.
//
// `runToQuiescence` below diverges from that harness loop in one deliberate way: it only ever
// auto-resolves a `noop`-executor node (deterministic/host-side code-behind, e.g. `explosion`'s
// parser) through its registered resolver. The moment it engages a node whose `ActResult.executor`
// names an external actor (`spawn-sub-agent` / `orchestrator-inline` / `request-human`), it stops
// and surfaces that node instead of ever dispatching it through a resolver — a resolver may hold a
// faked capability port, and faking a real agent/human's work is never this loop's job. The host
// (`http/engine-graph.ts`) relays the eventual real-world outcome back in as an event on a later
// call, which resumes driving from wherever this loop left off.
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

/** Nothing is frontier-eligible anymore — the whole tree under `root` has run to completion. */
export interface QuiescenceSettled {
  readonly settled: true;
  readonly steps: number;
}

/** Engaged a node whose `ActResult.executor` names an external actor — stopped before dispatching it to any resolver, surfacing it as the next action a host must carry out and relay back as an event. */
export interface QuiescenceStoppedAtActor {
  readonly settled: false;
  readonly reason: 'external-actor';
  readonly steps: number;
  readonly nodeId: NodeId;
  readonly type: NodeTypeName;
  readonly actResult: ActResult;
}

/** Neither settled nor stopped at an actor — `maxSteps` was hit while every step so far kept resolving in-service, the "never spin forever" guard. */
export interface QuiescenceNotSettled {
  readonly settled: false;
  readonly reason: 'max-steps';
  readonly steps: number;
  /** Every node still frontier-eligible when the `maxSteps` cap was hit. */
  readonly remaining: readonly NodeId[];
}

export type QuiescenceResult = QuiescenceSettled | QuiescenceStoppedAtActor | QuiescenceNotSettled;

/**
 * Runs the drive loop until it must stop: read the whole-tree frontier (`globalFrontier`), `engage`
 * one eligible node, repeat — one node at a time (never a batched round), re-reading the frontier
 * before every single step so a stale candidate is never acted on. A `noop`-executor node (a
 * deterministic/host-side code-behind, e.g. `explosion`'s parser) is resolved in-service through its
 * registered resolver and driving continues; any other executor (`spawn-sub-agent` /
 * `orchestrator-inline` / `request-human`) stops the loop immediately, before that node is ever
 * dispatched to a resolver — that node stays `in_progress`, and its `ActResult` is surfaced as the
 * next action for a host to carry out. `maxSteps` bounds the loop with a structured non-settle
 * result rather than spinning forever. An `engage` rejection on a node the frontier just certified
 * as eligible is a driver bug, surfaced as a thrown error rather than folded into a result.
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
    if (steps >= maxSteps) {
      return { settled: false, reason: 'max-steps', steps, remaining: frontierNow.map((node) => node.id) };
    }

    const next = frontierNow[0];
    const engaged = engage(ctx, registry, next.id);
    if (!engaged.ok) throw new Error(`driver: engage('${next.id}') failed: ${engaged.error.message}`);
    steps += 1;

    if (engaged.data.executor !== 'noop') {
      return { settled: false, reason: 'external-actor', steps, nodeId: next.id, type: next.type, actResult: engaged.data };
    }

    const resolver = resolvers[next.type];
    if (!resolver) throw new Error(`driver: no outcome resolver registered for node type '${next.type}'`);
    await resolver(ctx, registry, next, engaged.data);
  }
}
