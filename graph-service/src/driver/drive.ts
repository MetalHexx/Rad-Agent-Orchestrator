// graph-service/src/driver/drive.ts
//
// The driver loop: engage a frontier node, then — for a node whose own type declares a `resolve`
// hook — hand it the `ResolveContext` bridge (its own identity/data, a read-only scope view, and
// the capability ports) and commit whatever `ResolveOutcome` comes back, one node at a time. Ports
// are `async` (`Promise<Envelope>`); the engine's `engage`/`apply_event`/`expand`/`reset` are
// synchronous, so `advance` engages *before* it ever awaits anything, and commits the outcome only
// after that await settles. Adapted from `lib/graph-node-types/tests/harness/test-driver.ts`'s
// `runToQuiescence` loop, factored into a standalone `advance` step (this package's own
// contribution — the proven harness never separated it) so a single step is independently callable
// and testable.
//
// `runToQuiescence` below diverges from that harness loop in one deliberate way: it only ever
// auto-resolves a `noop`-executor node (deterministic/host-side code-behind, e.g. `explosion`'s
// parser) through its own `resolve` hook. The moment it engages a node whose `ActResult.executor`
// names an external actor (`spawn-sub-agent` / `orchestrator-inline` / `request-human`), it stops
// and surfaces that node instead of ever dispatching it — faking a real agent/human's work is never
// this loop's job. The host (`http/engine-graph.ts`) relays the eventual real-world outcome back in
// as an event on a later call, which resumes driving from wherever this loop left off.
import type {
  ActResult,
  CapabilityPortSet,
  DagNode,
  DataResolver,
  NodeId,
  NodeTypeName,
  NodeTypeRegistry,
  PrimitiveContext,
  Result,
} from '@rad-orchestration/graph-engine';
import { engage } from '@rad-orchestration/graph-engine';
import { globalFrontier } from './frontier.js';
import { applyOutcome } from './outcome.js';

export interface AdvanceResult {
  readonly nodeId: NodeId;
  readonly type: NodeTypeName;
}

/**
 * Resolves `node` via its own type's `resolve` hook: builds the `ResolveContext` bridge from the
 * live store plus `ports`, awaits the node's own outcome derivation, and commits it through
 * `applyOutcome`. The one place a `NodeTypeDefinition.resolve` is ever invoked, shared by
 * `advance`/`runToQuiescence`'s noop auto-resolution below and a host-driven re-derivation outside
 * the frontier walk (e.g. `http/engine-graph.ts`'s relayed `rad-orc:code_review` completion, never
 * trusted from the caller). A node type with no `resolve` hook is a driver bug, not a recoverable
 * outcome — it throws.
 */
export async function resolveViaNodeType(
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  ports: CapabilityPortSet,
  node: DagNode,
): Promise<void> {
  const definition = registry.resolve(node.type);
  if (!definition?.resolve) throw new Error(`driver: node type '${node.type}' has no resolve hook`);

  const outcome = await definition.resolve({
    nodeId: node.id,
    data: node.data,
    nodes: ctx.store.listNodes(ctx.scope),
    edges: ctx.store.listEdges(ctx.scope),
    ports,
  });
  applyOutcome(ctx, registry, node.id, outcome);
}

/**
 * One frontier step: `engage`s `node` — the synchronous `not_started -> in_progress` write plus
 * its `act` dispatch — then resolves it via {@link resolveViaNodeType}, which awaits whatever
 * capability port(s) `node`'s own `resolve` needs before committing the outcome via `applyOutcome`.
 * `engage` rejecting (e.g. `node` fell out of the frontier between selection and this call, or
 * `resolveData` — when supplied — refused to resolve one of `node`'s own declared fields) surfaces
 * as a structured `Result` failure here, never a thrown exception, so a caller decides how to react
 * instead of wrapping this in a try/catch.
 */
export async function advance(
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  ports: CapabilityPortSet,
  node: DagNode,
  resolveData?: DataResolver,
): Promise<Result<AdvanceResult>> {
  const engaged = engage(ctx, registry, node.id, resolveData);
  if (!engaged.ok) return engaged;

  await resolveViaNodeType(ctx, registry, ports, node);
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

/**
 * `engage` rejected a node the frontier just certified as eligible — a resolution refusal
 * (`resolveData`, when supplied, threw naming a field it couldn't fill) is the expected case; a
 * frontier race is not, but either way the host must relay this as an operator-actionable outcome,
 * never a thrown 500. `code`/`message` carry `engage`'s own rejection verbatim.
 */
export interface QuiescenceEngageFailed {
  readonly settled: false;
  readonly reason: 'engage-failed';
  readonly steps: number;
  readonly nodeId: NodeId;
  readonly code: string;
  readonly message: string;
}

export type QuiescenceResult = QuiescenceSettled | QuiescenceStoppedAtActor | QuiescenceNotSettled | QuiescenceEngageFailed;

/**
 * Runs the drive loop until it must stop: read the whole-tree frontier (`globalFrontier`), `engage`
 * one eligible node, repeat — one node at a time (never a batched round), re-reading the frontier
 * before every single step so a stale candidate is never acted on. A `noop`-executor node (a
 * deterministic/host-side code-behind, e.g. `explosion`'s parser) is resolved in-service through its
 * own `resolve` hook ({@link resolveViaNodeType}) and driving continues; any other executor
 * (`spawn-sub-agent` / `orchestrator-inline` / `request-human`) stops the loop immediately, before
 * that node is ever dispatched to `resolve` — that node stays `in_progress`, and its `ActResult` is
 * surfaced as the next action for a host to carry out. `maxSteps` bounds the loop with a structured
 * non-settle result rather than spinning forever. `resolveData`, when supplied, is threaded straight
 * into `engage` — an `engage` rejection (a resolution refusal, or a frontier race) is folded into a
 * {@link QuiescenceEngageFailed} result rather than thrown, so a host always replies through its own
 * uniform envelope. A `noop` node whose type declares no `resolve` hook is a driver bug (thrown by
 * {@link resolveViaNodeType}) — `rad-orc:phase` never reaches this branch since it's a `contains`
 * container that never reaches the frontier as a leaf.
 */
export async function runToQuiescence(
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  root: NodeId,
  ports: CapabilityPortSet,
  maxSteps = 300,
  resolveData?: DataResolver,
): Promise<QuiescenceResult> {
  let steps = 0;
  for (;;) {
    const frontierNow = globalFrontier(ctx, root);
    if (frontierNow.length === 0) return { settled: true, steps };
    if (steps >= maxSteps) {
      return { settled: false, reason: 'max-steps', steps, remaining: frontierNow.map((node) => node.id) };
    }

    const next = frontierNow[0];
    const engaged = engage(ctx, registry, next.id, resolveData);
    if (!engaged.ok) {
      return { settled: false, reason: 'engage-failed', steps, nodeId: next.id, code: engaged.error.code, message: engaged.error.message };
    }
    steps += 1;

    if (engaged.data.executor !== 'noop') {
      return { settled: false, reason: 'external-actor', steps, nodeId: next.id, type: next.type, actResult: engaged.data };
    }

    await resolveViaNodeType(ctx, registry, ports, next);
  }
}
