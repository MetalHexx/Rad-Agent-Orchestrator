// cli/tests/behavioral/pipeline/events/gate_mode_set.behavioral.test.ts
// NFR-5: if the state schema changes, update the seeded state below accordingly.
import { describe, it, beforeEach, afterEach } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEnvelopeAction } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { EXECUTION_TEMPLATE_BODY } from './fixtures/execution-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// State after plan_approved + gate_mode_selection triggered: pipeline.gate_mode is null.
// gate_mode_selection has gate_active=true (gate was triggered by the walker),
// auto_approve_modes includes [task, phase, autonomous] so gate_mode=task would auto-approve.
// To reach gate_mode_set, seed with pipeline.gate_mode=null (ask mode) and gate not yet active.
const afterPlanApprovedState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: { gate_mode: null, source_control: null, current_tier: 'execution', halt_reason: null },
  graph: {
    template_id: 'syn-exec',
    status: 'in_progress',
    current_node_path: null,
    nodes: {
      gate_mode_selection: { kind: 'gate', status: 'not_started', gate_active: false },
      phase_loop:          { kind: 'for_each_phase', status: 'not_started', iterations: [] },
      final_review:        { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    },
  },
};

describe('gate_mode_set event (FR-3, DD-2)', () => {
  it('gate_mode_set with gate_mode=task sets pipeline.gate_mode and returns action=display_complete or next walker action', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: afterPlanApprovedState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'ask', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'gate_mode_set', '--gate-mode', 'task', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true },
      state: {
        pipeline: { gate_mode: 'task' },
        graph: { template_id: 'syn-exec' },
      },
      sideFiles: [],
    });
    // FR-4, FR-23 — next action's completion event resolved from the catalog.
    assertPromptForEnvelopeAction(env);
  });
});
