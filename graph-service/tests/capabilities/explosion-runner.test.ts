import { EXPLOSION_PARSED_TOKEN, EXPLOSION_PARSE_FAILED_TOKEN } from '@rad-orchestration/graph-node-types';
import { describe, expect, it } from 'vitest';
import { createFakedCapabilityPorts } from '../../src/capabilities/fakes.js';
import type { ExplosionRunnerInput } from '../../src/capabilities/explosion-runner.js';
import { runExplosion } from '../../src/capabilities/explosion-runner.js';

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

function baseInput(overrides: Partial<ExplosionRunnerInput> = {}): ExplosionRunnerInput {
  return {
    explosionNodeId: 'explosion-1',
    masterPlanDocPath: MASTER_PLAN_PATH,
    masterPlanNodeId: 'master-plan-1',
    planApprovalNodeId: 'plan-approval-1',
    cadence: { perTask: [], perPhase: [], spine: [] },
    parseRetryCount: 0,
    ...overrides,
  };
}

describe('runExplosion', () => {
  it('happy parse: writes the expected phase/task docs and yields a parsed outcome', async () => {
    const ports = createFakedCapabilityPorts();
    ports.docRead.seed(MASTER_PLAN_PATH, WELL_FORMED);

    const result = await runExplosion(ports, baseInput());

    expect(result.token).toBe(EXPLOSION_PARSED_TOKEN);
    expect(result.envelope.outcome).toBe('ok');
    const data = result.envelope.data as { parsed: { phases: readonly unknown[] } };
    expect(data.parsed.phases).toHaveLength(2);

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

    const result = await runExplosion(ports, baseInput());

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

  it('re-explode over a corrected plan backs the prior output up before regenerating', async () => {
    const ports = createFakedCapabilityPorts();
    ports.docRead.seed(MASTER_PLAN_PATH, WELL_FORMED);

    // Simulate a prior run's output already sitting at the same target paths.
    ports.docRead.seed('docs/phases/phase-1.md', 'STALE PHASE 1');
    ports.docRead.seed('tasks/P01-T01-SCAFFOLD-THE-MODULE.md', 'STALE TASK 1');

    const result = await runExplosion(ports, baseInput({ _now: () => '2026-07-13T02:00:00.000Z' }));

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
