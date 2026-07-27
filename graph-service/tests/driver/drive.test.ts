import type { DataResolver, EventToken, NodeEvent, NodeTypeDefinition, PrimitiveContext, ProjectScope, ResolveContext } from '@rad-orchestration/graph-engine';
import { InMemoryStateStore, ROOT_NODE_ID, add_node, createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { describe, expect, it } from 'vitest';
import { createFakedCapabilityPorts } from '../../src/capabilities/fakes.js';
import { advance, runToQuiescence } from '../../src/driver/drive.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

/** A real master-plan fixture `parseMasterPlan` accepts and `rad-orc:explosion`'s own `resolve` can re-slice into docs. */
const MASTER_PLAN_DOC = `# Master Plan

## Phase 1: Foundation
Doc: docs/phases/phase-1.md
Exit Criteria:
- Foundations laid

### Task 1: Scaffold the module

## Phase 2: Delivery
Doc: docs/phases/phase-2.md
Exit Criteria:
- Delivery shipped

### Task 1: Ship it
`;

/** A minimal `noop`-executor node type that resolves itself the instant it's engaged — no capability port ever touched — standing in for a deterministic/host-side code-behind (e.g. `explosion`'s parser) without pulling in the real one's own preconditions. `onResolve`, if supplied, runs (and may await capability ports) before the canned outcome is returned — the ordering-proof test's hook. */
function autoStepType(name: `${string}:${string}`, onResolve?: (ctx: ResolveContext) => Promise<void>): NodeTypeDefinition {
  const doneToken: EventToken = `${name}.done`;
  return {
    name,
    dataSchema: {},
    traits: [],
    capabilities: [],
    presentation: { label: name },
    instructions: `# ${name}`,
    act: () => ({ instructions: `resolve ${name} in-service`, executor: 'noop' }),
    handle: (ev: NodeEvent) => (ev.token === doneToken && ev.envelope.outcome === 'ok' ? { dataChange: { ran: true } } : {}),
    projectStatus: (data) => (data.ran === true ? 'done' : 'not_started'),
    resolve: async (ctx) => {
      await onResolve?.(ctx);
      return { token: doneToken, envelope: { outcome: 'ok', data: {} } };
    },
  };
}

/** A `noop`-executor node type declaring no `resolve` hook at all — a genuine driver bug once it ever reaches the frontier as a leaf (unlike `rad-orc:phase`, a `contains` container that never does). */
function unresolvableNoopType(name: `${string}:${string}`): NodeTypeDefinition {
  return {
    name,
    dataSchema: {},
    traits: [],
    capabilities: [],
    presentation: { label: name },
    instructions: `# ${name}`,
    act: () => ({ instructions: `resolve ${name} in-service`, executor: 'noop' }),
    handle: () => ({}),
    projectStatus: () => 'not_started',
  };
}

/** A minimal external-actor node type (`request-human`) that carries no `resolve` hook at all — proof that the drive loop stopping before dispatch, rather than a resolve hook simply having nothing to do, is what leaves it untouched. */
function humanGateType(name: `${string}:${string}`): NodeTypeDefinition {
  return {
    name,
    dataSchema: {},
    traits: [],
    capabilities: ['request-human'],
    presentation: { label: name },
    instructions: `# ${name}`,
    act: () => ({ instructions: `ask the operator for ${name}`, executor: 'request-human' }),
    handle: () => ({}),
    projectStatus: () => 'not_started',
  };
}

describe('advance — noop-executor nodes via their own resolve hook', () => {
  it('drives a rad-orc:explosion to done via its own resolve hook, expanding one phase per parsed phase', async () => {
    const ctx = ctxFor('proj-advance-explosion');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'master-plan', 'rad-orc:master_plan', ROOT_NODE_ID, { data: { docPath: 'docs/master-plan/master-plan.md' } });
    add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, { data: { level: 'plan' } });
    add_node(ctx, registry, 'explosion', 'rad-orc:explosion', ROOT_NODE_ID, {
      data: { cadence: { perTask: [], perPhase: [], spine: [] } },
    });

    const ports = createFakedCapabilityPorts();
    ports.docRead.seed('docs/master-plan/master-plan.md', MASTER_PLAN_DOC);

    const explosionNode = ctx.store.getNode(ctx.scope, 'explosion');
    if (!explosionNode) throw new Error('missing seeded node');
    const result = await advance(ctx, registry, ports, explosionNode);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'explosion')?.status).toBe('done');
    // The real resolve hook really wrote the emitted phase/task docs; no agent/PR side effects.
    expect(ports.docWrite.writes.length).toBeGreaterThan(0);
    expect(ports.spawnAgent.spawned).toHaveLength(0);
    expect(ports.runCommand.ran).toHaveLength(0);
    // explosion's own handle-issued expansion actually landed (one phase per parsed phase).
    expect(ctx.store.getNode(ctx.scope, 'phase-1')?.type).toBe('rad-orc:phase');
  });

  it('engages synchronously (in_progress lands) before ever awaiting a capability port call, and only commits the outcome once that await settles', async () => {
    const ctx = ctxFor('proj-advance-ordering');
    const step = autoStepType('x:auto-step', async (resolveCtx) => {
      await resolveCtx.ports.docRead.read({ path: 'irrelevant' });
    });
    const registry = createNodeTypeRegistry([step]);
    add_node(ctx, registry, 'step-1', 'x:auto-step', ROOT_NODE_ID, {});

    const ports = createFakedCapabilityPorts();
    const node = ctx.store.getNode(ctx.scope, 'step-1');
    if (!node) throw new Error('missing seeded node');

    const pending = advance(ctx, registry, ports, node);

    // The synchronous portion of `advance` — `engage`'s `not_started -> in_progress` write — has
    // already landed even though nothing has been awaited yet; the outcome (the `ran` flag and the
    // resulting `done` re-projection) only commits once the returned promise is awaited.
    expect(ctx.store.getNode(ctx.scope, 'step-1')?.status).toBe('in_progress');
    expect(ctx.store.getNode(ctx.scope, 'step-1')?.data.ran).toBeUndefined();

    const result = await pending;

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'step-1')?.status).toBe('done');
  });

  it('returns a structured Result failure rather than throwing when the node has fallen out of the frontier', async () => {
    const ctx = ctxFor('proj-advance-rejected');
    const step = autoStepType('x:auto-step');
    const registry = createNodeTypeRegistry([step]);
    add_node(ctx, registry, 'step-1', 'x:auto-step', ROOT_NODE_ID, {});

    const ports = createFakedCapabilityPorts();
    const node = ctx.store.getNode(ctx.scope, 'step-1');
    if (!node) throw new Error('missing seeded node');

    await advance(ctx, registry, ports, node); // now done — no longer frontier-eligible
    const doneNode = ctx.store.getNode(ctx.scope, 'step-1');
    if (!doneNode) throw new Error('missing seeded node');

    const result = await advance(ctx, registry, ports, doneNode);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_in_frontier');
  });
});

describe('advance — driver bug: a node type with no resolve hook', () => {
  it('throws a clear error rather than silently doing nothing', async () => {
    const ctx = ctxFor('proj-advance-no-resolve');
    const type = unresolvableNoopType('x:unresolvable');
    const registry = createNodeTypeRegistry([type]);
    add_node(ctx, registry, 'step-1', 'x:unresolvable', ROOT_NODE_ID, {});

    const ports = createFakedCapabilityPorts();
    const node = ctx.store.getNode(ctx.scope, 'step-1');
    if (!node) throw new Error('missing seeded node');

    await expect(advance(ctx, registry, ports, node)).rejects.toThrow(/has no resolve hook/);
  });
});

describe('runToQuiescence', () => {
  it('auto-resolves rad-orc:explosion through its own resolve hook, then stops at the next external-actor node without dispatching it', async () => {
    const ctx = ctxFor('proj-quiescence-explosion');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'explosion', 'rad-orc:explosion', ROOT_NODE_ID, { data: { cadence: { perTask: [], perPhase: [], spine: [] } } });
    // `master-plan`/`plan-approval` must exist for explosion's own resolve precondition, but gate
    // them behind `explosion` so it's the sole live frontier candidate on tick one.
    add_node(ctx, registry, 'master-plan', 'rad-orc:master_plan', ROOT_NODE_ID, {
      data: { docPath: 'docs/master-plan/master-plan.md' },
      dependsOn: ['explosion'],
    });
    add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, { data: { level: 'plan' }, dependsOn: ['explosion'] });

    const ports = createFakedCapabilityPorts();
    ports.docRead.seed('docs/master-plan/master-plan.md', MASTER_PLAN_DOC);
    const result = await runToQuiescence(ctx, registry, ROOT_NODE_ID, ports);

    expect(result.settled).toBe(false);
    if (result.settled) throw new Error('expected the loop to stop at an external-actor node');
    expect(result.reason).toBe('external-actor');
    // explosion really ran its own resolve hook (parse + expand) in-service — no agent/PR side effects.
    expect(ctx.store.getNode(ctx.scope, 'explosion')?.status).toBe('done');
    expect(ports.docWrite.writes.length).toBeGreaterThan(0);
    expect(ports.spawnAgent.spawned).toHaveLength(0);
    // The next-eligible node (now unblocked) is the one the loop stopped at, still in_progress —
    // engaged but never dispatched through resolve.
    expect(result.nodeId).toBe('master-plan');
    expect(result.type).toBe('rad-orc:master_plan');
    expect(result.actResult.executor).toBe('orchestrator-inline');
    expect(ctx.store.getNode(ctx.scope, 'master-plan')?.status).toBe('in_progress');
  });

  it('drives a chain of deterministic nodes to full quiescence when nothing external ever gates it', async () => {
    const ctx = ctxFor('proj-quiescence-settled');
    const step1 = autoStepType('x:auto-step-1');
    const step2 = autoStepType('x:auto-step-2');
    const registry = createNodeTypeRegistry([step1, step2]);
    add_node(ctx, registry, 'step-1', 'x:auto-step-1', ROOT_NODE_ID, {});
    add_node(ctx, registry, 'step-2', 'x:auto-step-2', ROOT_NODE_ID, { dependsOn: ['step-1'] });

    const ports = createFakedCapabilityPorts();
    const result = await runToQuiescence(ctx, registry, ROOT_NODE_ID, ports);

    expect(result).toEqual({ settled: true, steps: 2 });
    expect(ctx.store.getNode(ctx.scope, 'step-1')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'step-2')?.status).toBe('done');
  });

  it('stops at an external-actor node and never dispatches it — its type carries no resolve hook at all', async () => {
    const ctx = ctxFor('proj-quiescence-stop');
    const step1 = autoStepType('x:auto-step');
    const gate = humanGateType('x:human-gate');
    const registry = createNodeTypeRegistry([step1, gate]);
    add_node(ctx, registry, 'step-1', 'x:auto-step', ROOT_NODE_ID, {});
    add_node(ctx, registry, 'gate-1', 'x:human-gate', ROOT_NODE_ID, { dependsOn: ['step-1'] });

    const ports = createFakedCapabilityPorts();
    // `x:human-gate` declares no `resolve` hook — if the loop ever tried to dispatch it, this would throw.
    const result = await runToQuiescence(ctx, registry, ROOT_NODE_ID, ports);

    expect(result.settled).toBe(false);
    if (result.settled) throw new Error('expected the loop to stop at the human gate');
    expect(result.reason).toBe('external-actor');
    expect(result.steps).toBe(2);
    expect(result.nodeId).toBe('gate-1');
    expect(result.actResult.executor).toBe('request-human');
    expect(ctx.store.getNode(ctx.scope, 'step-1')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'gate-1')?.status).toBe('in_progress');
  });

  it('returns the structured non-settle result once maxSteps is hit, rather than looping forever or throwing', async () => {
    const ctx = ctxFor('proj-quiescence-maxsteps');
    const step1 = autoStepType('x:auto-step-1');
    const step2 = autoStepType('x:auto-step-2');
    const registry = createNodeTypeRegistry([step1, step2]);
    add_node(ctx, registry, 'step-1', 'x:auto-step-1', ROOT_NODE_ID, {});
    add_node(ctx, registry, 'step-2', 'x:auto-step-2', ROOT_NODE_ID, { dependsOn: ['step-1'] });

    const ports = createFakedCapabilityPorts();
    const result = await runToQuiescence(ctx, registry, ROOT_NODE_ID, ports, 1);

    expect(result.settled).toBe(false);
    if (result.settled) throw new Error('expected the step cap to trip');
    expect(result.reason).toBe('max-steps');
    expect(result.steps).toBe(1);
    expect(result.remaining).toEqual(['step-2']);
    expect(ctx.store.getNode(ctx.scope, 'step-1')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'step-2')?.status).toBe('not_started');
  });

  it('throws a clear error when a noop node whose type declares no resolve hook reaches the frontier as a leaf', async () => {
    const ctx = ctxFor('proj-quiescence-no-resolve');
    const type = unresolvableNoopType('x:unresolvable');
    const registry = createNodeTypeRegistry([type]);
    add_node(ctx, registry, 'step-1', 'x:unresolvable', ROOT_NODE_ID, {});

    const ports = createFakedCapabilityPorts();
    await expect(runToQuiescence(ctx, registry, ROOT_NODE_ID, ports)).rejects.toThrow(/has no resolve hook/);
  });
});

describe('advance / runToQuiescence — a resolveData refusal is a structured failure, never a throw', () => {
  const REFUSING_FIELD = 'handoffDocPath';

  /** A `DataResolver` that refuses every node, mimicking the field resolver failing loud on an absent required field. */
  function refusingResolver(): DataResolver {
    return () => {
      throw new Error(`cannot resolve required field '${REFUSING_FIELD}': field is absent from node data`);
    };
  }

  it('advance folds a resolveData refusal into an invalid_delta Result, leaving the node not_started', async () => {
    const ctx = ctxFor('proj-advance-resolve-refusal');
    const registry = createNodeTypeRegistry([autoStepType('x:auto-step')]);
    add_node(ctx, registry, 'step-1', 'x:auto-step', ROOT_NODE_ID, {});

    const ports = createFakedCapabilityPorts();
    const node = ctx.store.getNode(ctx.scope, 'step-1');
    if (!node) throw new Error('missing seeded node');

    const result = await advance(ctx, registry, ports, node, refusingResolver());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_delta');
      expect(result.error.message).toContain(REFUSING_FIELD);
    }
    // The refusal rejected before the in-progress write — the node stays re-engageable.
    expect(ctx.store.getNode(ctx.scope, 'step-1')?.status).toBe('not_started');
  });

  it('runToQuiescence surfaces a resolveData refusal as a QuiescenceEngageFailed result, never a throw', async () => {
    const ctx = ctxFor('proj-quiescence-resolve-refusal');
    const registry = createNodeTypeRegistry([autoStepType('x:auto-step')]);
    add_node(ctx, registry, 'step-1', 'x:auto-step', ROOT_NODE_ID, {});

    const ports = createFakedCapabilityPorts();
    const result = await runToQuiescence(ctx, registry, ROOT_NODE_ID, ports, 300, refusingResolver());

    expect(result.settled).toBe(false);
    if (result.settled) throw new Error('expected the loop to stop at the engage refusal');
    if (result.reason !== 'engage-failed') throw new Error(`expected engage-failed, got '${result.reason}'`);
    expect(result.nodeId).toBe('step-1');
    expect(result.code).toBe('invalid_delta');
    expect(result.message).toContain(REFUSING_FIELD);
    expect(result.steps).toBe(0);
    // Never dispatched: the node stays not_started, re-engageable once the field can resolve.
    expect(ctx.store.getNode(ctx.scope, 'step-1')?.status).toBe('not_started');
  });
});
