// cli/tests/behavioral/pipeline/events/plan_approved.behavioral.test.ts
import { describe, it, beforeEach, afterEach } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForTerminalAction } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { PLANNING_TEMPLATE_BODY } from './fixtures/planning-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// Master plan doc has total_phases and total_tasks required by plan_approved pre-read validation.
// The path is relative and will be resolved to projectDir/master-plan.md by the engine.
const MASTER_PLAN_DOC_PATH = 'master-plan.md';
const MASTER_PLAN_DOC_CONTENTS = `---\ntotal_phases: 2\ntotal_tasks: 4\n---\nMaster plan content.\n`;

// State after explosion_completed: all planning steps completed, gate pending with gate_active=true.
// master_plan.doc_path is set so plan_approved can derive it via pre-read.
const afterExplosionCompletedState = {
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
      master_plan:        { kind: 'step', status: 'completed', doc_path: MASTER_PLAN_DOC_PATH, retries: 0 },
      explode_master_plan:{ kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      plan_approval_gate: { kind: 'gate', status: 'not_started', gate_active: true },
    },
  },
};

describe('plan_approved event (FR-3, FR-8, FR-9, DD-2, DD-5)', () => {
  it('plan_approved marks plan_approval_gate completed, sets current_tier=execution, and returns action=display_complete', async () => {
    const w = buildWorld({
      template: { id: 'syn-planning', body: PLANNING_TEMPLATE_BODY },
      state: afterExplosionCompletedState,
      config: { default_template: 'syn-planning' },
      sideFiles: [{ path: MASTER_PLAN_DOC_PATH, contents: MASTER_PLAN_DOC_CONTENTS }],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'plan_approved', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true, data: { action: 'display_complete' } },
      state: {
        graph: {
          status: 'completed',
          nodes: {
            plan_approval_gate: { status: 'completed', gate_active: true },
          },
        },
        pipeline: { current_tier: 'execution' },
      },
      sideFiles: [],
    });
    // FR-5 — display_complete is terminal; composed prompt omits both the
    // "## When complete" heading and the Signal line.
    assertPromptForTerminalAction(env);
  });
});
