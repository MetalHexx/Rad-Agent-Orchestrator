import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import type { DagNode, NodeSpec, ResolveContext } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import {
  EXPLOSION_NODE_TYPE,
  EXPLOSION_PARSED_TOKEN,
  EXPLOSION_PARSE_FAILED_TOKEN,
  buildExecutionExpansion,
  createExplosionNodeType,
  parseMasterPlan,
} from '../../src/rad-orc/explosion.js';
import { DECORATION_CADENCE_FIXTURE } from '../fixtures/decoration-cadence.js';
import { createFakedCapabilityPorts } from '../harness/test-driver.js';

const TEMPLATE_SHAPED_MASTER_PLAN = `# Master Plan

## Phase 1: Foundation
Doc: phases/PHASE-01.md
Exit Criteria:
- All packages build
- Tests pass

### Task 1: Scaffold
### Task 2: Core Model

## Phase 2: Readiness
Doc: phases/PHASE-02.md
Exit Criteria:
- Frontier derivation works

### Task 1: Frontier
`;

function specByKey(specs: readonly NodeSpec[], key: string): NodeSpec {
  const found = specs.find((spec) => spec.key === key);
  if (!found) throw new Error(`no spec with key '${key}' — available: ${specs.map((s) => s.key).join(', ')}`);
  return found;
}

describe('parseMasterPlan — the sole code-behind', () => {
  it('parses a template-shaped master plan into phases/tasks values', () => {
    const result = parseMasterPlan(TEMPLATE_SHAPED_MASTER_PLAN);
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;

    expect(result.data.phases).toHaveLength(2);
    const [phase1, phase2] = result.data.phases;

    expect(phase1).toMatchObject({
      id: 'phase-1',
      title: 'Foundation',
      docPath: 'phases/PHASE-01.md',
      exitCriteria: ['All packages build', 'Tests pass'],
    });
    expect(phase1.tasks.map((t) => t.id)).toEqual(['phase-1-task-1', 'phase-1-task-2']);
    expect(phase1.tasks.map((t) => t.title)).toEqual(['Scaffold', 'Core Model']);

    expect(phase2).toMatchObject({ id: 'phase-2', docPath: 'phases/PHASE-02.md', exitCriteria: ['Frontier derivation works'] });
    expect(phase2.tasks.map((t) => t.id)).toEqual(['phase-2-task-1']);
  });

  it('rejects content declared before the first phase heading', () => {
    const result = parseMasterPlan('### Task 1: orphaned\n');
    expect(result.outcome).toBe('error');
    if (result.outcome !== 'error') return;
    expect(result.data.message).toMatch(/before the first phase heading/);
  });

  it('rejects a phase missing its Doc: line', () => {
    const result = parseMasterPlan('## Phase 1: Foundation\nExit Criteria:\n- x\n\n### Task 1: a\n');
    expect(result.outcome).toBe('error');
    if (result.outcome !== 'error') return;
    expect(result.data.message).toMatch(/never declared a `Doc:` line/);
  });

  it('rejects a phase declaring no exit criteria', () => {
    const result = parseMasterPlan('## Phase 1: Foundation\nDoc: phases/P1.md\n\n### Task 1: a\n');
    expect(result.outcome).toBe('error');
    if (result.outcome !== 'error') return;
    expect(result.data.message).toMatch(/no exit criteria/);
  });

  it('rejects a phase declaring no tasks', () => {
    const result = parseMasterPlan('## Phase 1: Foundation\nDoc: phases/P1.md\nExit Criteria:\n- x\n');
    expect(result.outcome).toBe('error');
    if (result.outcome !== 'error') return;
    expect(result.data.message).toMatch(/declares no tasks/);
  });

  it('rejects an unrecognized line inside a phase', () => {
    const result = parseMasterPlan('## Phase 1: Foundation\nsome garbage line\n');
    expect(result.outcome).toBe('error');
    if (result.outcome !== 'error') return;
    expect(result.data.message).toMatch(/unrecognized line/);
  });

  it('rejects a doc with no phases at all', () => {
    const result = parseMasterPlan('# Master Plan\n');
    expect(result.outcome).toBe('error');
    if (result.outcome !== 'error') return;
    expect(result.data.message).toMatch(/no phases/);
  });
});

describe('buildExecutionExpansion — cadence decorates parsed values, never invents structure', () => {
  it('seeds a phase per parsed phase, a task per parsed task, and the cadence review nodes, gated behind approval(plan)', () => {
    const parsed = parseMasterPlan(TEMPLATE_SHAPED_MASTER_PLAN);
    expect(parsed.outcome).toBe('ok');
    if (parsed.outcome !== 'ok') return;

    const expansion = buildExecutionExpansion(parsed.data, DECORATION_CADENCE_FIXTURE, 'approval-plan');
    const { specs } = expansion;

    const phase1 = specByKey(specs, 'phase-1');
    expect(phase1).toMatchObject({ type: 'rad-orc:phase', parent: ROOT_NODE_ID, dependsOn: ['approval-plan'] });

    const task1 = specByKey(specs, 'phase-1-task-1');
    expect(task1).toMatchObject({ type: 'rad-orc:task', parent: 'phase-1', dependsOn: [] });

    // one perTask review chained after task 1, gating task 2
    const task1Review = specByKey(specs, 'phase-1-task-1-code_review-0');
    expect(task1Review).toMatchObject({ type: 'rad-orc:code_review', parent: 'phase-1', dependsOn: ['phase-1-task-1'], data: { level: 'task' } });

    const task2 = specByKey(specs, 'phase-1-task-2');
    expect(task2.dependsOn).toEqual(['phase-1-task-1-code_review-0']);

    const task2Review = specByKey(specs, 'phase-1-task-2-code_review-0');
    expect(task2Review.dependsOn).toEqual(['phase-1-task-2']);

    // one perPhase review chained after the last task's review
    const phase1Review = specByKey(specs, 'phase-1-code_review-0');
    expect(phase1Review).toMatchObject({ type: 'rad-orc:code_review', parent: 'phase-1', dependsOn: ['phase-1-task-2-code_review-0'], data: { level: 'phase' } });

    // phase 2 is gated behind phase 1's own final decoration, not phase 1 itself
    const phase2 = specByKey(specs, 'phase-2');
    expect(phase2).toMatchObject({ type: 'rad-orc:phase', parent: ROOT_NODE_ID, dependsOn: ['phase-1-code_review-0'] });

    // the spine attaches once, at the root, chained after the last phase's own final decoration
    const phase2Review = specByKey(specs, 'phase-2-code_review-0');
    const spineReview = specByKey(specs, 'spine-code_review-0');
    const spinePr = specByKey(specs, 'spine-pr-1');
    const spineApproval = specByKey(specs, 'spine-approval-2');

    expect(spineReview).toMatchObject({ type: 'rad-orc:code_review', parent: ROOT_NODE_ID, dependsOn: [phase2Review.key], data: { level: 'final' } });
    expect(spinePr).toMatchObject({ type: 'rad-orc:pr', parent: ROOT_NODE_ID, dependsOn: [spineReview.key], data: {} });
    expect(spineApproval).toMatchObject({ type: 'rad-orc:approval', parent: ROOT_NODE_ID, dependsOn: [spinePr.key], data: { level: 'final' } });

    // every batch key is unique — expand() rejects a duplicate outright
    expect(new Set(specs.map((s) => s.key)).size).toBe(specs.length);
  });
});

describe('rad-orc:explosion node type', () => {
  it('declares the expands trait, a noop executor, and its own code-behind capability', () => {
    expect(EXPLOSION_NODE_TYPE.name).toBe('rad-orc:explosion');
    expect(EXPLOSION_NODE_TYPE.traits).toEqual(['expands']);
    expect(EXPLOSION_NODE_TYPE.act({ nodeId: 'explosion', data: {} }).executor).toBe('noop');
  });

  it('handle emits the expand batch on a successful parse and marks itself expanded', () => {
    const parsed = parseMasterPlan(TEMPLATE_SHAPED_MASTER_PLAN);
    expect(parsed.outcome).toBe('ok');
    if (parsed.outcome !== 'ok') return;

    const result = EXPLOSION_NODE_TYPE.handle({
      token: EXPLOSION_PARSED_TOKEN,
      nodeId: 'explosion',
      envelope: { outcome: 'ok', data: { parsed: parsed.data, cadence: DECORATION_CADENCE_FIXTURE, planApprovalNodeId: 'approval-plan' } },
    });

    expect(result.dataChange).toEqual({ parseRetryCount: 0, lastParseError: null, expanded: true });
    expect(result.expansion?.specs.length).toBeGreaterThan(0);
    expect(EXPLOSION_NODE_TYPE.projectStatus({ expanded: true })).toBe('done');
    expect(EXPLOSION_NODE_TYPE.projectStatus({})).toBe('not_started');
  });

  it('a parse failure under the retry cap routes back to master_plan via a cascade reset', () => {
    const explosion = createExplosionNodeType({ parseRetryLimit: 2 });
    const result = explosion.handle({
      token: EXPLOSION_PARSE_FAILED_TOKEN,
      nodeId: 'explosion',
      envelope: {
        outcome: 'error',
        data: { parseError: { line: 3, expected: 'x', found: 'y', message: 'bad' }, masterPlanNodeId: 'master_plan', parseRetryCount: 0 },
      },
    });

    expect(result.routing).toEqual({ primitive: 'reset', params: { node: 'master_plan', cascade: true } });
    expect(result.dataChange).toMatchObject({ parseRetryCount: 1 });
  });

  it('a parse failure past the retry cap halts via a self-toggle and resets its own retry count', () => {
    const explosion = createExplosionNodeType({ parseRetryLimit: 2 });
    const result = explosion.handle({
      token: EXPLOSION_PARSE_FAILED_TOKEN,
      nodeId: 'explosion',
      envelope: {
        outcome: 'error',
        data: { parseError: { line: 3, expected: 'x', found: 'y', message: 'bad' }, masterPlanNodeId: 'master_plan', parseRetryCount: 2 },
      },
    });

    expect(result.routing).toEqual({ primitive: 'toggle', params: { node: 'explosion' } });
    expect(result.dataChange).toEqual({
      parseRetryCount: 0,
      lastParseError: { line: 3, expected: 'x', found: 'y', message: 'bad' },
    });
  });

  it('handle ignores an unrelated token', () => {
    expect(
      EXPLOSION_NODE_TYPE.handle({ token: 'rad-orc:explosion.other', nodeId: 'explosion', envelope: { outcome: 'ok', data: {} } }),
    ).toEqual({});
  });

  it('declares doc-read/doc-write alongside its own code-behind capability', () => {
    expect(EXPLOSION_NODE_TYPE.capabilities).toEqual(expect.arrayContaining(['rad-orc:master-plan-parser', 'doc-read', 'doc-write']));
  });
});

describe('resolve — the relocated explosion runner', () => {
  const MASTER_PLAN_PATH = 'docs/master-plan/mp.md';

  const WELL_FORMED = `# Master Plan

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
### Task 2: Write the docs
`;

  // Missing the required `Doc:` line under Phase 1 — parseMasterPlan rejects this at end-of-phase.
  const MALFORMED = `## Phase 1: Foundation
Exit Criteria:
- Foundations laid

### Task 1: Scaffold
`;

  function masterPlanSibling(overrides: Partial<DagNode> = {}): DagNode {
    return {
      id: 'master-plan-1',
      type: 'rad-orc:master_plan',
      status: 'done',
      parent: ROOT_NODE_ID,
      order: 0,
      derivedFrom: null,
      data: { docPath: MASTER_PLAN_PATH },
      ...overrides,
    };
  }

  function planApprovalSibling(overrides: Partial<DagNode> = {}): DagNode {
    return {
      id: 'plan-approval-1',
      type: 'rad-orc:approval',
      status: 'not_started',
      parent: ROOT_NODE_ID,
      order: 1,
      derivedFrom: null,
      data: { level: 'plan' },
      ...overrides,
    };
  }

  function buildContext(
    ports: ReturnType<typeof createFakedCapabilityPorts>,
    overrides: { readonly data?: Readonly<Record<string, unknown>>; readonly nodes?: readonly DagNode[] } = {},
  ): ResolveContext {
    return {
      nodeId: 'explosion-1',
      data: { cadence: DECORATION_CADENCE_FIXTURE, parseRetryCount: 0, ...overrides.data },
      nodes: overrides.nodes ?? [masterPlanSibling(), planApprovalSibling()],
      edges: [],
      ports,
    };
  }

  it('happy parse: writes the expected phase/task docs and yields a parsed outcome', async () => {
    const ports = createFakedCapabilityPorts();
    ports.docRead.seed(MASTER_PLAN_PATH, WELL_FORMED);

    const result = await EXPLOSION_NODE_TYPE.resolve!(buildContext(ports));

    expect(result.token).toBe(EXPLOSION_PARSED_TOKEN);
    expect(result.envelope.outcome).toBe('ok');
    const data = result.envelope.data as { parsed: { phases: readonly unknown[] }; planApprovalNodeId: string };
    expect(data.parsed.phases).toHaveLength(2);
    expect(data.planApprovalNodeId).toBe('plan-approval-1');

    const writtenPaths = ports.docWrite.writes.map((w) => w.path).sort();
    expect(writtenPaths).toEqual([
      'docs/phases/phase-1.md',
      'docs/phases/phase-2.md',
      'tasks/P01-T01-SCAFFOLD-THE-MODULE.md',
      'tasks/P02-T01-SHIP-IT.md',
      'tasks/P02-T02-WRITE-THE-DOCS.md',
    ]);

    const phase1Doc = ports.docWrite.writes.find((w) => w.path === 'docs/phases/phase-1.md');
    expect(phase1Doc?.content).toContain('## Phase 1: Foundation');
    expect(phase1Doc?.content).toContain('Doc: docs/phases/phase-1.md');
    expect(phase1Doc?.content).not.toContain('Phase 2');

    const task1Doc = ports.docWrite.writes.find((w) => w.path === 'tasks/P01-T01-SCAFFOLD-THE-MODULE.md');
    expect(task1Doc?.content).toBe('### Task 1: Scaffold the module');
  });

  it('malformed plan: yields a structured parse_failed outcome and writes no docs', async () => {
    const ports = createFakedCapabilityPorts();
    ports.docRead.seed(MASTER_PLAN_PATH, MALFORMED);

    const result = await EXPLOSION_NODE_TYPE.resolve!(buildContext(ports));

    expect(result.token).toBe(EXPLOSION_PARSE_FAILED_TOKEN);
    expect(result.envelope.outcome).toBe('error');
    const data = result.envelope.data as {
      parseError: { line: number; expected: string; found: string; message: string };
      masterPlanNodeId: string;
      parseRetryCount: number;
    };
    expect(data.parseError.message).toContain('never declared a `Doc:` line');
    expect(data.masterPlanNodeId).toBe('master-plan-1');
    expect(data.parseRetryCount).toBe(0);
    expect(ports.docWrite.writes).toHaveLength(0);
  });

  it('carries the parseRetryCount forward from ctx.data on a parse failure', async () => {
    const ports = createFakedCapabilityPorts();
    ports.docRead.seed(MASTER_PLAN_PATH, MALFORMED);

    const result = await EXPLOSION_NODE_TYPE.resolve!(buildContext(ports, { data: { parseRetryCount: 2 } }));

    const data = result.envelope.data as { parseRetryCount: number };
    expect(data.parseRetryCount).toBe(2);
  });

  it('re-explode over a corrected plan backs the prior output up before regenerating, via the injected clock seam', async () => {
    const explosion = createExplosionNodeType({ now: () => '2026-07-13T02:00:00.000Z' });
    const ports = createFakedCapabilityPorts();
    ports.docRead.seed(MASTER_PLAN_PATH, WELL_FORMED);

    // Simulate a prior run's output already sitting at the same target paths.
    ports.docRead.seed('docs/phases/phase-1.md', 'STALE PHASE 1');
    ports.docRead.seed('tasks/P01-T01-SCAFFOLD-THE-MODULE.md', 'STALE TASK 1');

    const result = await explosion.resolve!(buildContext(ports));

    expect(result.token).toBe(EXPLOSION_PARSED_TOKEN);

    const backupWrites = ports.docWrite.writes.filter((w) => w.path.startsWith('backups/'));
    expect(backupWrites.map((w) => w.path).sort()).toEqual([
      'backups/2026-07-13T02-00-00-000Z/docs/phases/phase-1.md',
      'backups/2026-07-13T02-00-00-000Z/tasks/P01-T01-SCAFFOLD-THE-MODULE.md',
    ]);
    expect(backupWrites.find((w) => w.path.includes('phase-1'))?.content).toBe('STALE PHASE 1');
    expect(backupWrites.find((w) => w.path.includes('P01-T01'))?.content).toBe('STALE TASK 1');

    const freshPhase1 = ports.docWrite.writes.find((w) => w.path === 'docs/phases/phase-1.md');
    expect(freshPhase1?.content).toContain('## Phase 1: Foundation');

    // A target with no prior content on disk gets no backup entry.
    expect(backupWrites.some((w) => w.path.includes('phase-2'))).toBe(false);
  });
});
