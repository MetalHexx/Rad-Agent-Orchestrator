// cli/tests/behavioral/pipeline/unhappy/invalid-transition.behavioral.test.ts
import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { PLANNING_TEMPLATE_BODY } from '../events/fixtures/planning-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

// Planning-tier state — no phase_loop has been scaffolded yet, so firing
// task_completed is a genuine invalid transition. The mutation throws because
// resolveNodeState('task_executor', 'task', 1, 1) cannot find a phase_loop in
// graph.nodes; the engine catches that and returns ok:false.
const planningTierState = {
  $schema: 'orchestration-state-v5',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: { gate_mode: 'task', source_control: null, current_tier: 'planning', halt_reason: null },
  graph: {
    template_id: 'syn-planning',
    status: 'in_progress',
    current_node_path: null,
    nodes: {
      gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
      requirements:        { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      master_plan:         { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      explosion:           { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      plan_approval_gate:  { kind: 'gate', status: 'not_started', gate_active: false },
    },
  },
};

describe('invalid-transition unhappy class (FR-5)', () => {
  it('task_completed during planning tier returns ok:false and leaves state.json unchanged', async () => {
    const w = buildWorld({
      template: { id: 'syn-planning', body: PLANNING_TEMPLATE_BODY },
      state: planningTierState,
      config: {},
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const before = fs.readFileSync(path.join(w.projectDir, 'state.json'), 'utf8');
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'task_completed', '--project-dir', w.projectDir, '--phase', '1', '--task', '1', '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    const after = fs.readFileSync(path.join(w.projectDir, 'state.json'), 'utf8');
    expect(after).toBe(before);
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: false, error: { type: 'user_error' } },
      state: planningTierState,
      sideFiles: [],
    });
  });
});
