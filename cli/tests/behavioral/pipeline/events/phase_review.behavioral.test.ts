// cli/tests/behavioral/pipeline/events/phase_review.behavioral.test.ts
// Covers phase_review_started and phase_review_completed (verdict=approved) events (FR-3, FR-8, DD-2, DD-4).
// NFR-5: if the state schema changes, update the seeded states below accordingly.
import { describe, it, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
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

// State after phase_review_started: phase_review=in_progress.
const afterPhaseReviewStartedState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
  graph: {
    template_id: 'syn-exec',
    status: 'in_progress',
    current_node_path: 'phase_loop[0].phase_review',
    nodes: {
      gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
      phase_loop: {
        kind: 'for_each_phase',
        status: 'in_progress',
        iterations: [
          {
            index: 0,
            status: 'in_progress',
            doc_path: null,
            repos: [],
            corrective_tasks: [],
            nodes: {
              task_loop: {
                kind: 'for_each_task',
                status: 'completed',
                iterations: [
                  {
                    index: 0,
                    status: 'completed',
                    doc_path: null,
                    repos: [],
                    corrective_tasks: [],
                    nodes: {
                      task_gate:     { kind: 'gate', status: 'completed', gate_active: true },
                      task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                      code_review:   { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                    },
                  },
                ],
              },
              phase_gate:   { kind: 'gate', status: 'completed', gate_active: true },
              phase_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
            },
          },
        ],
      },
      final_review:        { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    },
  },
};

const REVIEW_DOC_PATH = 'phase-review.md';
// phase_review_completed requires verdict + exit_criteria_met in frontmatter (see frontmatter-validators.ts).
const REVIEW_DOC_CONTENTS = `---\nverdict: approved\nexit_criteria_met: true\n---\nPhase review content.\n`;

// Per FR-11, `phase_review_started` is no longer accepted as an event; step
// transition to in_progress now happens via the optimistic write in
// processEvent (FR-10). The behavioral arm for that signal was deleted with
// the event identifier itself; the completed arm below carries the remaining
// behavior coverage for the phase_review step.

describe('phase_review_completed event with verdict=approved (FR-3, FR-8, DD-2, DD-4)', () => {
  it('phase_review_completed with verdict=approved marks phase_review completed and returns next action', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: afterPhaseReviewStartedState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [{ path: REVIEW_DOC_PATH, contents: REVIEW_DOC_CONTENTS }],
    });
    cleanups.push(w.cleanup);
    const reviewDocAbsPath = path.join(w.projectDir, REVIEW_DOC_PATH);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'phase_review_completed', '--verdict', 'approved', '--doc-path', reviewDocAbsPath, '--phase', '1', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true },
      state: {
        graph: { template_id: 'syn-exec' },
      },
      sideFiles: [],
    });
    // FR-4, FR-23 — next action's completion event resolved from the catalog.
    assertPromptForEnvelopeAction(env);
  });
});
