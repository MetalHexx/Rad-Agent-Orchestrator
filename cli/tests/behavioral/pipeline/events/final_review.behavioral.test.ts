// cli/tests/behavioral/pipeline/events/final_review.behavioral.test.ts
// Covers final_review_started, final_review_completed (verdict=approved), and final_approved events
// (FR-3, FR-9, DD-2, DD-4, DD-5).
// NFR-5: if the state schema changes, update the seeded states below accordingly.
import { describe, it, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEvent, assertPromptForTerminalAction } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { EXECUTION_TEMPLATE_BODY } from './fixtures/execution-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// State after final_review_started: final_review=in_progress.
const afterFinalReviewStartedState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
  graph: {
    template_id: 'syn-exec',
    status: 'in_progress',
    current_node_path: 'final_review',
    nodes: {
      gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
      phase_loop: {
        kind: 'for_each_phase',
        status: 'completed',
        iterations: [
          {
            index: 0,
            status: 'completed',
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
              phase_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
            },
          },
        ],
      },
      final_review:        { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
      final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    },
  },
};

// State after final_review_completed with verdict=approved: final_review=completed,
// final_approval_gate pending, pipeline.current_tier=review.
const afterFinalReviewCompletedState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: { gate_mode: 'task', source_control: null, current_tier: 'review', halt_reason: null },
  graph: {
    template_id: 'syn-exec',
    status: 'in_progress',
    current_node_path: 'final_approval_gate',
    nodes: {
      gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
      phase_loop: {
        kind: 'for_each_phase',
        status: 'completed',
        iterations: [
          {
            index: 0,
            status: 'completed',
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
              phase_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
            },
          },
        ],
      },
      final_review:        { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: true },
    },
  },
};

const FINAL_REVIEW_DOC_PATH = 'final-review.md';
const FINAL_REVIEW_DOC_CONTENTS = `---\nverdict: approved\n---\nFinal review content.\n`;

// Per FR-11, `final_review_started` is no longer accepted as an event; step
// transition to in_progress now happens via the optimistic write in
// processEvent (FR-10). The behavioral arm for that signal was deleted with
// the event identifier itself; the completed arm below carries the remaining
// behavior coverage for the final_review step.

describe('final_review_completed event with verdict=approved (FR-3, FR-9, DD-2, DD-4)', () => {
  it('final_review_completed with verdict=approved marks final_review completed, sets current_tier=review, returns request_final_approval', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: afterFinalReviewStartedState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [{ path: FINAL_REVIEW_DOC_PATH, contents: FINAL_REVIEW_DOC_CONTENTS }],
    });
    cleanups.push(w.cleanup);
    const reviewDocAbsPath = path.join(w.projectDir, FINAL_REVIEW_DOC_PATH);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'final_review_completed', '--verdict', 'approved', '--doc-path', reviewDocAbsPath, '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true, data: { action: 'request_final_approval' } },
      state: {
        pipeline: { current_tier: 'review' },
        graph: {
          template_id: 'syn-exec',
          nodes: { final_review: { status: 'completed' } },
        },
      },
      sideFiles: [],
    });
    // FR-4, FR-23 — request_final_approval's completion event is final_approved.
    assertPromptForEvent(env, 'final_approved');
  });
});

describe('final_approved event (FR-3, FR-9, DD-2, DD-5)', () => {
  it('final_approved marks final_approval_gate completed and returns action=display_complete', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: afterFinalReviewCompletedState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'final_approved', '--project-dir', w.projectDir, '--config', w.configPath],
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
          nodes: { final_approval_gate: { status: 'completed', gate_active: true } },
        },
      },
      sideFiles: [],
    });
    // FR-5 — display_complete is terminal (completion_event = null). The
    // composed prompt omits both the "## When complete" heading and the
    // Signal line entirely.
    assertPromptForTerminalAction(env);
  });
});
