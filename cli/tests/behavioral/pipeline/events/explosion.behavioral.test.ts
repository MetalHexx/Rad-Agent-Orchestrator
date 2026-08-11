// cli/tests/behavioral/pipeline/events/explosion.behavioral.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEvent } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { explodeMasterPlan } from '../../../../src/lib/explode-master-plan.js';
import { PLANNING_TEMPLATE_BODY } from './fixtures/planning-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// State after master_plan_completed: requirements+master_plan=completed, rest=not_started
const afterMasterPlanCompletedState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: { gate_mode: null, source_control: null, current_tier: 'planning', halt_reason: null },
  graph: {
    template_id: 'syn-planning',
    status: 'in_progress',
    current_node_path: null,
    nodes: {
      requirements:       { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      master_plan:        { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      explode_master_plan:{ kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      plan_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    },
  },
};

// Per FR-11, `explosion_started` is no longer accepted as an event; step
// transition to in_progress now happens via the optimistic write in
// processEvent (FR-10). The behavioral arm for that signal was deleted with
// the event identifier itself; the completed arm below carries the remaining
// behavior coverage for the explode_master_plan step.
describe('explosion events (FR-3, FR-7, DD-2, DD-4)', () => {
  it('explosion_completed marks explode_master_plan node completed and returns action=request_plan_approval', async () => {
    const stateWithExplosionInProgress = {
      ...afterMasterPlanCompletedState,
      graph: {
        ...afterMasterPlanCompletedState.graph,
        nodes: {
          ...afterMasterPlanCompletedState.graph.nodes,
          explode_master_plan: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
        },
      },
    };
    const w = buildWorld({
      template: { id: 'syn-planning', body: PLANNING_TEMPLATE_BODY },
      state: stateWithExplosionInProgress,
      config: { default_template: 'syn-planning' },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'explosion_completed', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true, data: { action: 'request_plan_approval' } },
      state: {
        graph: {
          nodes: {
            explode_master_plan: { status: 'completed' },
            plan_approval_gate: { status: 'in_progress', gate_active: true },
          },
        },
      },
      sideFiles: [],
    });
    // FR-4, FR-23 — request_plan_approval's completion event is plan_approved.
    assertPromptForEvent(env, 'plan_approved');
  });
});

// ── Helpers for seedIterations tests ─────────────────────────────────────────

function seedStateAndPlan(
  planBody: string,
): { projectDir: string; masterPlanPath: string } {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-seed-'));
  const masterPlanPath = path.join(projectDir, 'MP.md');
  fs.writeFileSync(masterPlanPath, planBody, 'utf8');
  // Minimal v6 state.json with a phase_loop for_each_phase node and empty iterations.
  const minimalState = {
    $schema: 'orchestration-state-v6',
    project: { name: 'X', created: '2026-05-22T00:00:00.000Z', updated: '2026-05-22T00:00:00.000Z' },
    config: {
      gate_mode: 'task',
      limits: { max_retries_per_task: 3 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: null, source_control: null, current_tier: 'planning', halt_reason: null },
    graph: {
      template_id: 'syn-planning',
      status: 'in_progress',
      current_node_path: null,
      nodes: {
        phase_loop: {
          kind: 'for_each_phase',
          status: 'not_started',
          iterations: [],
        },
      },
    },
  };
  fs.writeFileSync(path.join(projectDir, 'state.json'), JSON.stringify(minimalState, null, 2), 'utf8');
  return { projectDir, masterPlanPath };
}

describe('seedIterations — task repos (FR-11, DD-2)', () => {
  it('seeds task iteration repos and complexity from the parsed task (FR-11, DD-2)', () => {
    const { projectDir, masterPlanPath } = seedStateAndPlan(
      '---\nrepos: [backend, shared]\n---\n\n## P01: P\n\n### P01-T01: A\nWires backend to shared.\n**Complexity:** complex\n**Target repo:** backend, shared\n**Files for backend:**\n- Create: `a.ts`\n**Files for shared:**\n- Create: `b.ts`\n');
    explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const state = JSON.parse(fs.readFileSync(path.join(projectDir, 'state.json'), 'utf8'));
    const taskEntry = state.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0];
    expect(taskEntry.repos).toEqual([
      { name: 'backend', commit_hash: null },
      { name: 'shared', commit_hash: null },
    ]);
    expect(taskEntry.complexity).toBe('complex');
  });

  it('seeds standard complexity when the task has no Complexity line (FR-11)', () => {
    const { projectDir, masterPlanPath } = seedStateAndPlan(
      '---\nrepos: [backend]\n---\n\n## P01: P\n\n### P01-T01: A\nWires backend.\n**Target repo:** backend\n**Files for backend:**\n- Create: `a.ts`\n');
    explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const state = JSON.parse(fs.readFileSync(path.join(projectDir, 'state.json'), 'utf8'));
    const taskEntry = state.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0];
    expect(taskEntry.complexity).toBe('standard');
  });
});

describe('seedIterations — phase repos (FR-12, AD-4)', () => {
  it('seeds phase iteration repos as the task union (FR-12, AD-4)', () => {
    const { projectDir, masterPlanPath } = seedStateAndPlan(
      '---\nrepos: [backend, frontend, shared]\n---\n\n## P01: P\n**Target repo:** shared\n\n' +
      '### P01-T01: A\nWires backend to shared.\n**Complexity:** standard\n**Target repo:** backend, shared\n**Files for backend:**\n- Create: `a.ts`\n**Files for shared:**\n- Create: `b.ts`\n\n' +
      '### P01-T02: B\nAdds the frontend view.\n**Complexity:** simple\n**Target repo:** frontend\n**Files for frontend:**\n- Create: `c.ts`\n');
    explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const state = JSON.parse(fs.readFileSync(path.join(projectDir, 'state.json'), 'utf8'));
    const phaseEntry = state.graph.nodes.phase_loop.iterations[0];
    expect(phaseEntry.repos).toEqual([
      { name: 'backend', commit_hash: null },
      { name: 'shared', commit_hash: null },
      { name: 'frontend', commit_hash: null },
    ]);
  });
});
