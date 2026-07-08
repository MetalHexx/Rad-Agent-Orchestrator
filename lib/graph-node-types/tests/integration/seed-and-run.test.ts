// The full integration proof (P05-T02): seed a project DAG by replaying a template-shaped batch
// through the public primitives alone, trim it, then run it to quiescence over the P05-T01 driver
// contract. Titles cite the behavior + governing seam each test proves, per the telemetry tests'
// own style (hand-rolled fakes, explicit vitest imports, `globals: false`).
import type { PrimitiveContext, ProjectScope, ReviewSpawnRequest } from '@rad-orchestration/graph-engine';
import {
  InMemoryStateStore,
  ROOT_NODE_ID,
  add_dependency,
  add_node,
  createNodeTypeRegistry,
  expand,
  remaining,
  remove_node,
} from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import type { ParsedMasterPlan } from '../../src/index.js';
import { BUILT_IN_NODE_TYPES } from '../../src/index.js';
import { buildExecutionExpansion } from '../../src/rad-orc/explosion.js';
import { DECORATION_CADENCE_FIXTURE } from '../fixtures/decoration-cadence.js';
import { SECURITY_SCAN_SCANNED_TOKEN, TEAM_SECURITY_SCAN_NODE_TYPE, interpret } from '../fixtures/team-security-scan.js';
import type { NodeOutcomeResolver } from '../harness/test-driver.js';
import {
  applyOutcome,
  createBuiltInResolvers,
  createFakedCapabilityPorts,
  globalFrontier,
  isGloballyQuiescent,
  runToQuiescence,
} from '../harness/test-driver.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

describe('seed -> trim -> run: a template-shaped batch through the public primitives alone', () => {
  it('replays add_node/add_dependency/expand to seed a decorated project graph, trims a review to a lighter intensity, and runs the whole graph to quiescence with every container done', async () => {
    const ctx = ctxFor('proj-seed');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    const kickoffData = {
      handoffDocPath: '/tasks/kickoff.md',
      repos: [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-1' }],
      complexity: 'simple' as const,
      shouldCommit: true,
    };
    expect(add_node(ctx, registry, 'kickoff', 'rad-orc:task', ROOT_NODE_ID, { data: kickoffData }).ok).toBe(true);
    expect(add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, { data: { level: 'plan' } }).ok).toBe(true);
    expect(add_dependency(ctx, 'kickoff', 'plan-approval').ok).toBe(true);

    const parsed: ParsedMasterPlan = {
      phases: [
        {
          id: 'phase-1',
          title: 'Foundations',
          docPath: 'docs/phases/phase-1.md',
          exitCriteria: ['Foundations laid'],
          tasks: [
            { id: 'phase-1-task-1', title: 'Scaffold the module' },
            { id: 'phase-1-task-2', title: 'Wire the seams' },
          ],
        },
        {
          id: 'phase-2',
          title: 'Delivery',
          docPath: 'docs/phases/phase-2.md',
          exitCriteria: ['Delivery shipped'],
          tasks: [{ id: 'phase-2-task-1', title: 'Ship it' }],
        },
      ],
    };
    const expansion = buildExecutionExpansion(parsed, DECORATION_CADENCE_FIXTURE, 'plan-approval');
    const expanded = expand(ctx, registry, ROOT_NODE_ID, expansion);
    expect(expanded.ok).toBe(true);

    // Trim: drop phase-1's second per-task review to hit a lighter intensity — remove_node's own
    // 'heal' dependents strategy re-points the per-phase review straight onto the task it now trails.
    const trimmed = remove_node(ctx, 'phase-1-task-2-code_review-0', { dependents: 'heal' });
    expect(trimmed.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'phase-1-task-2-code_review-0')).toBeNull();
    expect(
      ctx.store.listEdges(ctx.scope).some((edge) => edge.from === 'phase-1-task-2' && edge.to === 'phase-1-code_review-0'),
    ).toBe(true);

    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports);

    const { steps } = await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);

    expect(steps).toBeGreaterThan(0);
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true);
    expect(() => globalFrontier(ctx, ROOT_NODE_ID)).not.toThrow(); // acyclic + tree-shaped throughout the whole run

    const doneIds = [
      'kickoff',
      'plan-approval',
      'phase-1-task-1',
      'phase-1-task-1-code_review-0',
      'phase-1-task-2',
      'phase-1-code_review-0',
      'phase-2-task-1',
      'phase-2-task-1-code_review-0',
      'phase-2-code_review-0',
      'spine-code_review-0',
      'spine-pr-1',
      'spine-approval-2',
    ];
    for (const id of doneIds) {
      expect(ctx.store.getNode(ctx.scope, id)?.status).toBe('done');
    }

    // The container rolls up: every phase, and the root itself, has nothing left `remaining`.
    const nodes = ctx.store.listNodes(ctx.scope);
    expect(remaining(nodes, ROOT_NODE_ID)).toEqual([]);
    expect(remaining(nodes, 'phase-1')).toEqual([]);
    expect(remaining(nodes, 'phase-2')).toEqual([]);
  });
});

describe('rad-orc:master_plan -> rad-orc:explosion seed their own decorated subgraph, end-to-end through the driver', () => {
  it('authors the plan doc via doc-read/doc-write, parses it via the code-behind, and expands the decorated subgraph from a handle-issued expansion', async () => {
    const ctx = ctxFor('proj-explosion');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    add_node(ctx, registry, 'master-plan', 'rad-orc:master_plan', ROOT_NODE_ID);
    add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, {
      data: { level: 'plan' },
      dependsOn: ['master-plan'],
    });
    add_node(ctx, registry, 'explosion', 'rad-orc:explosion', ROOT_NODE_ID, {
      data: { cadence: DECORATION_CADENCE_FIXTURE },
      dependsOn: ['master-plan'],
    });

    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports);

    const { steps } = await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);

    expect(steps).toBeGreaterThan(0);
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'master-plan')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'explosion')?.status).toBe('done');
    expect(ports.docWrite.writes).toHaveLength(1);
    expect(ports.docWrite.writes[0].content).toContain('## Phase 1');

    // explosion's own handle-issued expansion seeded the decorated subgraph — proving `expand`
    // dispatched from a HandleResult behaves identically to a direct primitive call.
    expect(ctx.store.getNode(ctx.scope, 'phase-1')?.type).toBe('rad-orc:phase');
    expect(ctx.store.getNode(ctx.scope, 'phase-1-task-1')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'phase-1-task-1-code_review-0')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'spine-approval-2')?.status).toBe('done');
  });
});

describe('rad-orc:explosion halts (frontier-excluded) once its parse-retry cap is exhausted', () => {
  it('a master plan that never parses drives explosion through parseRetryLimit + 1 failure cycles, then it self-disables and the graph reaches quiescence', async () => {
    const ctx = ctxFor('proj-explosion-halt');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    add_node(ctx, registry, 'master-plan', 'rad-orc:master_plan', ROOT_NODE_ID);
    add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, {
      data: { level: 'plan' },
      dependsOn: ['master-plan'],
    });
    add_node(ctx, registry, 'explosion', 'rad-orc:explosion', ROOT_NODE_ID, {
      data: { cadence: DECORATION_CADENCE_FIXTURE },
      dependsOn: ['master-plan'],
    });

    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports, { masterPlanDoc: '# Master Plan\n' }); // no phases — never parses

    await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);

    const explosion = ctx.store.getNode(ctx.scope, 'explosion');
    expect(explosion?.disabled).toBe(true);
    expect(explosion?.data.parseRetryCount).toBe(0); // reset at halt time — a later resume gets a fresh window
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true); // maxSteps never throws — the halt actually stops the loop
  });
});

describe('a custom team:* node type registers through the same registry and runs to completion via the same driver', () => {
  function withCustomResolver(ports: ReturnType<typeof createFakedCapabilityPorts>, rawFindings: readonly string[]) {
    const resolvers: Readonly<Record<string, NodeOutcomeResolver>> = {
      ...createBuiltInResolvers(ports),
      'team:security_scan': async (runCtx, runRegistry, node, actResult) => {
        await ports.spawnAgent.spawn({
          originatingNodeId: node.id,
          idempotencyKey: `${node.id}:spawn`,
          request: actResult.payload as ReviewSpawnRequest,
        });
        const interpreted = interpret({ rawFindings });
        applyOutcome(runCtx, runRegistry, node.id, { token: SECURITY_SCAN_SCANNED_TOKEN, envelope: interpreted });
      },
    };
    return resolvers;
  }

  it('spawns a triage agent, interprets a clean scan via its own code-behind, and reaches done', async () => {
    const ctx = ctxFor('proj-team-clean');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES, [TEAM_SECURITY_SCAN_NODE_TYPE]);
    add_node(ctx, registry, 'security-scan', 'team:security_scan', ROOT_NODE_ID, {
      data: { repos: [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-1' }] },
    });

    const ports = createFakedCapabilityPorts();
    const { steps } = await runToQuiescence(ctx, registry, ROOT_NODE_ID, withCustomResolver(ports, []));

    expect(steps).toBe(1);
    expect(ctx.store.getNode(ctx.scope, 'security-scan')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'security-scan')?.data.verdict).toBe('clear');
    expect(ports.spawnAgent.spawned).toHaveLength(1);
  });

  it('halts (blocked) once the code-behind flags a finding — the same recoverable-halt shape as approval/code_review', async () => {
    const ctx = ctxFor('proj-team-flagged');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES, [TEAM_SECURITY_SCAN_NODE_TYPE]);
    add_node(ctx, registry, 'security-scan', 'team:security_scan', ROOT_NODE_ID, { data: { repos: [] } });

    const ports = createFakedCapabilityPorts();
    await runToQuiescence(ctx, registry, ROOT_NODE_ID, withCustomResolver(ports, ['hardcoded-secret: found an inline API key']));

    const node = ctx.store.getNode(ctx.scope, 'security-scan');
    expect(node?.status).toBe('blocked');
    expect(node?.data.findings).toEqual([{ rule: 'hardcoded-secret', detail: 'found an inline API key' }]);
  });
});
