// cli/tests/behavioral/pipeline/events/code_review.behavioral.test.ts
// Covers code_review_started and code_review_completed (verdict=approved) events (FR-3, FR-7, DD-2, DD-4).
// NFR-5: if the state schema changes, update the seeded states below accordingly.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, afterEach, expect } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog, useTempCatalogCopy } from '../helpers/catalog.js';
import { assertPromptForEnvelopeAction } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { EXECUTION_TEMPLATE_BODY } from './fixtures/execution-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

// State after code_review_started: code_review=in_progress.
const afterCodeReviewStartedState = {
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
    current_node_path: 'phase_loop[0].task_loop[0].code_review',
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
                status: 'in_progress',
                iterations: [
                  {
                    index: 0,
                    status: 'in_progress',
                    doc_path: null,
                    repos: [],
                    corrective_tasks: [],
                    nodes: {
                      task_gate:     { kind: 'gate', status: 'completed', gate_active: true },
                      task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                      code_review:   { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                    },
                  },
                ],
              },
              phase_gate:   { kind: 'gate', status: 'not_started', gate_active: false },
              phase_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
            },
          },
        ],
      },
      final_review:        { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    },
  },
};

const REVIEW_DOC_PATH = 'code-review.md';
const REVIEW_DOC_CONTENTS = `---\nverdict: approved\n---\nCode review content.\n`;

// Per FR-11, `code_review_started` is no longer accepted as an event; step
// transition to in_progress now happens via the optimistic write in
// processEvent (FR-10). The behavioral arm for that signal was deleted with
// the event identifier itself; the completed arm below carries the remaining
// behavior coverage for the code_review step.

describe('code_review_completed event with verdict=approved (FR-3, FR-7, DD-2, DD-4)', () => {
  it('code_review_completed with verdict=approved marks code_review completed and advances the walker', async () => {
    cleanups.push(useRealCatalog());
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: afterCodeReviewStartedState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [{ path: REVIEW_DOC_PATH, contents: REVIEW_DOC_CONTENTS }],
    });
    cleanups.push(w.cleanup);
    const reviewDocAbsPath = path.join(w.projectDir, REVIEW_DOC_PATH);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'code_review_completed', '--verdict', 'approved', '--doc-path', reviewDocAbsPath, '--phase', '1', '--task', '1', '--project-dir', w.projectDir, '--config', w.configPath],
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
    // FR-4, FR-23 — the next action's completion event is resolved from the
    // catalog (per the handoff: "per resolved action" rows read live).
    assertPromptForEnvelopeAction(env);
  });
});

// ── Custom-slot subtests (FR-5, FR-9, AD-7, NFR-7) ──────────────────────────
// These tests fire `task_completed` rather than `code_review_completed` so
// the engine's next action is `spawn_code_reviewer` — whose completion event
// (`code_review_completed`) drives custom-slot composition. Firing
// code_review_completed instead advances PAST the code_review step, so the
// composed prompt would target the NEXT step's event (e.g. commit_completed),
// which would miss the custom-slot wiring being exercised here.
describe('code_review prompt composition — custom slots (FR-5, FR-9, AD-7, NFR-7)', () => {
  // State that puts the walker at task_executor completed, code_review pending
  // — i.e. firing task_completed leaves the next action as spawn_code_reviewer.
  const beforeCodeReviewState = {
    ...afterCodeReviewStartedState,
    graph: {
      ...afterCodeReviewStartedState.graph,
      current_node_path: 'phase_loop[0].task_loop[0].task_executor',
      nodes: {
        ...afterCodeReviewStartedState.graph.nodes,
        phase_loop: {
          ...afterCodeReviewStartedState.graph.nodes.phase_loop,
          iterations: [
            {
              ...afterCodeReviewStartedState.graph.nodes.phase_loop.iterations[0],
              nodes: {
                ...afterCodeReviewStartedState.graph.nodes.phase_loop.iterations[0].nodes,
                task_loop: {
                  ...afterCodeReviewStartedState.graph.nodes.phase_loop.iterations[0].nodes.task_loop,
                  iterations: [
                    {
                      ...afterCodeReviewStartedState.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0],
                      nodes: {
                        ...afterCodeReviewStartedState.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].nodes,
                        task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                        code_review:   { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };

  async function fireTaskCompleted(projectDir: string, configPath: string): Promise<{ ok: boolean; data?: unknown; error?: unknown }> {
    return captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'task_completed', '--phase', '1', '--task', '1', '--project-dir', projectDir, '--config', configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
  }

  it('event-pre custom slot is composed into the prompt under "## Before signaling" (FR-5)', async () => {
    const cat = useTempCatalogCopy();
    cleanups.push(cat.restore);
    const customBody = 'CUSTOM EVENT-PRE BODY — composed verbatim under the Before signaling heading.';
    fs.writeFileSync(
      path.join(cat.root, 'custom', 'event.code_review_completed.pre.md'),
      customBody,
      'utf8',
    );
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: beforeCodeReviewState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await fireTaskCompleted(w.projectDir, w.configPath);
    const data = env.data as { action?: string; prompt?: string; completion_event?: string | null };
    expect(data.action, 'next action after task_completed').toBe('spawn_code_reviewer');
    expect(data.completion_event).toBe('code_review_completed');
    const prompt = data.prompt as string;
    // Custom body is admitted under a Step-N heading (Step-N numbering replaced fixed headings).
    expect(prompt).toContain(customBody);
    // The custom event-pre body must appear after the action body (Step 1).
    const actionBodyIdx = prompt.indexOf('## Step 1');
    const bodyIdx = prompt.indexOf(customBody);
    expect(bodyIdx, 'custom body should appear after the action body section').toBeGreaterThan(actionBodyIdx);
  });

  it('unrelated custom file is INERT — only the consumed completion event is validated (AD-7)', async () => {
    const cat = useTempCatalogCopy();
    cleanups.push(cat.restore);
    // Both files exist: a custom for a bogus event AND a (matching) custom for
    // the event actually consumed by spawn_code_reviewer. The bogus custom
    // must NOT raise even though no catalog file backs `bogus_event`, because
    // the envelope only consumes the code_review_completed event.
    fs.writeFileSync(
      path.join(cat.root, 'custom', 'event.bogus_event.pre.md'),
      'Bogus custom that should be inert.',
      'utf8',
    );
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: beforeCodeReviewState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await fireTaskCompleted(w.projectDir, w.configPath);
    expect(env.ok, 'envelope should succeed despite the inert unrelated custom').toBe(true);
    const data = env.data as { action?: string; prompt?: string };
    expect(data.action).toBe('spawn_code_reviewer');
    // The bogus custom body must not have leaked into the composed prompt.
    expect(data.prompt as string).not.toContain('Bogus custom that should be inert.');
  });

  it('unknown completion_event in the action frontmatter raises a validation error naming the missing catalog file (FR-9, NFR-7)', async () => {
    const cat = useTempCatalogCopy();
    cleanups.push(cat.restore);
    // Mutate the action's completion_event to a non-existent event AND seed
    // a custom file that references the real (still-existing) completion
    // event slot. The composer's frontmatter resolver looks up the
    // (now-bogus) completion event named in the action — that catalog file
    // does not exist, so composeActionPrompt throws with the missing path.
    const actionFile = path.join(cat.root, 'action.spawn_code_reviewer.md');
    const original = fs.readFileSync(actionFile, 'utf8');
    const mutated = original.replace(
      /completion_event:\s*code_review_completed/,
      'completion_event: nonexistent_event_xyz',
    );
    expect(mutated, 'mutation must change the action file').not.toBe(original);
    fs.writeFileSync(actionFile, mutated, 'utf8');
    // A real custom file at the original event slot — present but moot since
    // the action no longer points at it.
    fs.writeFileSync(
      path.join(cat.root, 'custom', 'event.code_review_completed.pre.md'),
      'Custom body for the unmutated event slot.',
      'utf8',
    );
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: beforeCodeReviewState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await fireTaskCompleted(w.projectDir, w.configPath);
    // pipelineSignal wraps engine throws into ok:false / user_error envelopes.
    expect(env.ok, 'envelope should fail when the action names an unknown event').toBe(false);
    const error = env.error as { message?: string };
    expect(error?.message ?? '', 'error message names the missing catalog file').toContain(
      'event.nonexistent_event_xyz.md',
    );
    expect(error?.message ?? '', 'error message names the unknown event').toContain(
      'nonexistent_event_xyz',
    );
  });
});
