// cli/tests/behavioral/pipeline/events/master_plan.behavioral.test.ts
import { describe, it, beforeEach, afterEach } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEvent } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { PLANNING_TEMPLATE_BODY } from './fixtures/planning-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// Base post-start planning state — master_plan is the first node; there is no
// requirements node. After `start`, master_plan is in_progress.
const postStartPlanningState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: { gate_mode: null, source_control: null, current_tier: 'planning', halt_reason: null },
  graph: {
    template_id: 'syn-planning',
    status: 'in_progress',
    current_node_path: null,
    nodes: {
      master_plan:        { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      explode_master_plan:{ kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      plan_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    },
  },
};

// Per FR-11, `master_plan_started` is no longer accepted as an event; step
// transition to in_progress now happens via the optimistic write in
// processEvent (FR-10). The behavioral arm for that signal was deleted with
// the event identifier itself; the completed arm below carries the remaining
// behavior coverage for the master_plan step.
describe('master_plan events (FR-3, FR-7, DD-2, DD-4)', () => {
  it('master_plan_completed marks master_plan node completed and returns action=explode_master_plan', async () => {
    const stateWithMasterPlanInProgress = {
      ...postStartPlanningState,
      graph: {
        ...postStartPlanningState.graph,
        nodes: {
          ...postStartPlanningState.graph.nodes,
          master_plan: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
        },
      },
    };
    // master_plan_completed requires a doc file (no specific frontmatter validation, but must be readable)
    const masterPlanDoc = `---\ntitle: Master Plan\n---\nMaster plan content here.\n`;
    const w = buildWorld({
      template: { id: 'syn-planning', body: PLANNING_TEMPLATE_BODY },
      state: stateWithMasterPlanInProgress,
      config: { default_template: 'syn-planning' },
      sideFiles: [{ path: 'master-plan.md', contents: masterPlanDoc }],
    });
    cleanups.push(w.cleanup);
    const masterPlanDocPath = `${w.projectDir}/master-plan.md`;
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'master_plan_completed', '--project-dir', w.projectDir, '--doc-path', masterPlanDocPath, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true, data: { action: 'explode_master_plan' } },
      state: {
        graph: {
          nodes: {
            master_plan: { status: 'completed' },
            explode_master_plan: { status: 'in_progress' },
          },
        },
      },
      sideFiles: [],
    });
    // FR-4, FR-23 — explode_master_plan's completion event is explosion_completed.
    assertPromptForEvent(env, 'explosion_completed');
  });
});
