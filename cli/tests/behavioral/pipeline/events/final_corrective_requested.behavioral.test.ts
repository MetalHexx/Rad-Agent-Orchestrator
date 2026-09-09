// cli/tests/behavioral/pipeline/events/final_corrective_requested.behavioral.test.ts
//
// The operator change request at the final approval gate, driven through the
// CLI envelope. Three surfaces matter here and nothing else: the envelope, the
// resulting state.json, and the running final review report the engine appends
// the operator's objection to.
//
// The report append and the state write cannot be one atomic operation, so the
// cases below pin where the append commits (after validation, not before) and
// that re-signalling after a lost state write does not append a second time.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, afterEach, beforeEach, expect } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEnvelopeAction } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { EXECUTION_TEMPLATE_BODY } from './fixtures/execution-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

const REPORT_PATH = 'reports/final-review.md';
const OPERATOR_REASON = 'The migration path is undocumented, and the rollback story is missing entirely.';

const REVIEW_REPORT = [
  '---',
  'verdict: approved',
  '---',
  '',
  '# Final Review',
  '',
  '## Findings',
  '',
  '### Finding 1 — Logging is inconsistent across the adapters',
  '',
  'The two adapters disagree on log level.',
  '',
  '## Verdict',
  '',
  'Approved.',
  '',
].join('\n');

async function signal(projectDir: string, configPath: string, argv: string[]) {
  return captureEnvelope(async () => {
    await runCommand(pipelineSignalCommand, {
      argv: [...argv, '--project-dir', projectDir, '--config', configPath],
      env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: projectDir },
      isTTY: false, stderr: process.stderr,
    });
  });
}

function makeWorld(
  state: unknown,
  sideFiles: Array<{ path: string; contents: string }> = [{ path: REPORT_PATH, contents: REVIEW_REPORT }],
  configOverrides: Record<string, unknown> = {},
) {
  const w = buildWorld({
    template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
    state: state as Parameters<typeof buildWorld>[0]['state'],
    config: {
      default_template: 'syn-exec',
      human_gates: { after_planning: true, execution_mode: 'autonomous', after_final_review: true },
      ...configOverrides,
    },
    sideFiles,
  });
  cleanups.push(w.cleanup);
  return w;
}

const readState = (projectDir: string) => JSON.parse(fs.readFileSync(path.join(projectDir, 'state.json'), 'utf8'));
const readText = (projectDir: string, rel: string) => fs.readFileSync(path.join(projectDir, rel), 'utf8');
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** A completed project parked at the final approval gate: the reviewer's report
 *  has landed, the gate is blocking on a person, and nothing else is open. */
function atFinalGateState(finalReviewOverrides: Record<string, unknown> = {}) {
  return {
    $schema: 'orchestration-state-v6',
    project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
    config: {
      gate_mode: 'autonomous',
      limits: { max_retries_per_task: 3 },
      source_control: { auto_commit: 'always', auto_pr: 'never' },
    },
    pipeline: {
      gate_mode: 'autonomous',
      source_control: {
        worktree_name: 'cli-behavioral',
        auto_commit: 'always',
        auto_pr: 'never',
        repos: [{ name: 'backend', branch: 'feature/final-syn', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
      },
      current_tier: 'review',
      halt_reason: null,
    },
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
              index: 0, status: 'completed', doc_path: null, repos: [], corrective_tasks: [],
              nodes: {
                task_loop: {
                  kind: 'for_each_task',
                  status: 'completed',
                  iterations: [
                    {
                      index: 0, status: 'completed', doc_path: null,
                      repos: [{ name: 'backend', commit_hash: 'origHash1' }],
                      corrective_tasks: [],
                      nodes: {
                        task_gate:     { kind: 'gate', status: 'completed', gate_active: false },
                        task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                        code_review:   { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                      },
                    },
                  ],
                },
                phase_gate:   { kind: 'gate', status: 'completed', gate_active: false },
                phase_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
              },
            },
          ],
        },
        final_review: {
          kind: 'step', status: 'completed', doc_path: REPORT_PATH, retries: 0, verdict: 'approved',
          ...finalReviewOverrides,
        },
        final_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
      },
    },
  };
}

/** A spent corrective entry from an earlier round, shaped like the default
 *  task-loop body the final host scaffolds. */
function spentCorrective(index: number) {
  return {
    index,
    reason: 'An earlier round of work',
    injected_after: 'final_review',
    status: 'completed',
    doc_path: null,
    review_report_path: REPORT_PATH,
    repos: [{ name: 'backend', commit_hash: `spent${index}` }],
    nodes: {
      task_gate:     { kind: 'gate', status: 'completed', gate_active: false },
      task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      code_review:   { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
    },
  };
}

describe('final_corrective_requested — the operator objects and the objection becomes work', () => {
  it('records the objection on the running report, births a corrective from it, and routes into that corrective rather than a reviewer re-spawn', async () => {
    const w = makeWorld(atFinalGateState());

    const env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_corrective_requested', '--reason', OPERATOR_REASON,
    ]);

    expect(env.ok, env.error?.message).toBe(true);
    const data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('execute_task');
    expect(data.action).not.toBe('spawn_final_reviewer');
    expect(data.context.task_id).toBe('FINAL');
    expect(data.context.corrective_index).toBe(1);
    assertPromptForEnvelopeAction(env);

    const onDisk = readState(w.projectDir);
    const host = onDisk.graph.nodes.final_review;
    expect(host.status).toBe('in_progress');
    expect(host.corrective_budget_origin).toBe(0);
    expect(host.corrective_tasks).toHaveLength(1);
    expect(host.corrective_tasks[0].reason).toBe(OPERATOR_REASON);
    expect(host.corrective_tasks[0].review_report_path).toBe(REPORT_PATH);
    expect(host.corrective_tasks[0].nodes.task_executor.status).toBe('in_progress');
    expect(onDisk.pipeline.current_tier).toBe('review');
    expect(onDisk.graph.status).toBe('in_progress');

    // The operator's words reach the report verbatim, and the reviewer's own
    // document survives around them — frontmatter, prior finding, and the
    // sections that follow Findings.
    const report = readText(w.projectDir, REPORT_PATH);
    expect(occurrences(report, OPERATOR_REASON)).toBe(1);
    expect(report.startsWith('---\nverdict: approved\n---')).toBe(true);
    expect(report).toContain('Logging is inconsistent across the adapters');
    expect(report.indexOf(OPERATOR_REASON)).toBeLessThan(report.indexOf('## Verdict'));
  });

  it('stands the approval gate down for the duration of the corrective, and lets the walker re-arm it once the corrective closes', async () => {
    const crDoc = 'reports/final-cr-1.md';
    const w = makeWorld(atFinalGateState(), [
      { path: REPORT_PATH, contents: REVIEW_REPORT },
      { path: crDoc, contents: '---\nverdict: approved\n---\nThe objection is answered.\n' },
    ]);

    let env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_corrective_requested', '--reason', OPERATOR_REASON,
    ]);
    expect(env.ok, env.error?.message).toBe(true);

    // While the corrective is in flight the gate is neither active nor mid-flight:
    // every dashboard surface reads gate_active + status to decide whether to offer
    // the operator an Approve button, and approving here would complete the gate
    // over an open corrective.
    let gate = readState(w.projectDir).graph.nodes.final_approval_gate;
    expect(gate).toMatchObject({ status: 'not_started', gate_active: false });

    env = await signal(w.projectDir, w.configPath, [
      '--event', 'task_completed',
      '--repos', JSON.stringify([{ name: 'backend', committed: true, commitHash: 'opcorr1', pushed: true }]),
      '--branch', 'feature/final-syn',
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    expect((env.data as { action: string }).action).toBe('spawn_code_reviewer');

    env = await signal(w.projectDir, w.configPath, [
      '--event', 'code_review_completed', '--doc-path', path.join(w.projectDir, crDoc), '--verdict', 'approved',
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    expect((env.data as { action: string }).action).toBe('request_final_approval');

    // Standing the gate down is a pause, not a retirement: the walker's
    // not_started arm arms it again the moment final_review closes.
    const onDisk = readState(w.projectDir);
    expect(onDisk.graph.nodes.final_review.status).toBe('completed');
    gate = onDisk.graph.nodes.final_approval_gate;
    expect(gate).toMatchObject({ status: 'in_progress', gate_active: true });
  });

  it('opens a fresh budget window per request, so a request past a spent window still births while a failing agent inside one still halts', async () => {
    const w = makeWorld(
      atFinalGateState({ corrective_tasks: [spentCorrective(1)], corrective_budget_origin: 0 }),
      [{ path: REPORT_PATH, contents: REVIEW_REPORT }],
      { limits: { max_retries_per_task: 1 } },
    );

    // The window is already at the ceiling (one entry, max_retries_per_task=1).
    // A request that drew on it would halt; because it opens its own, it births.
    let env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_corrective_requested', '--reason', OPERATOR_REASON,
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    expect((env.data as { action: string }).action).toBe('execute_task');

    let onDisk = readState(w.projectDir);
    expect(onDisk.graph.nodes.final_review.corrective_budget_origin).toBe(1);
    expect(onDisk.graph.nodes.final_review.corrective_tasks).toHaveLength(2);
    expect(onDisk.graph.status).toBe('in_progress');

    // Inside that fresh window the agent budget is unchanged: one attempt, and
    // a coder who cannot satisfy the request halts rather than looping.
    env = await signal(w.projectDir, w.configPath, [
      '--event', 'task_completed',
      '--repos', JSON.stringify([{ name: 'backend', committed: true, commitHash: 'opcorr1', pushed: true }]),
      '--branch', 'feature/final-syn',
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    expect((env.data as { action: string }).action).toBe('spawn_code_reviewer');

    const crDoc = 'reports/final-cr-1.md';
    fs.writeFileSync(
      path.join(w.projectDir, crDoc),
      '---\nverdict: changes_requested\n---\nStill not covered.\n',
      'utf8',
    );
    env = await signal(w.projectDir, w.configPath, [
      '--event', 'code_review_completed', '--doc-path', path.join(w.projectDir, crDoc), '--verdict', 'changes_requested',
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    expect((env.data as { action: string }).action).toBe('display_halted');

    onDisk = readState(w.projectDir);
    expect(onDisk.graph.status).toBe('halted');
    expect(onDisk.pipeline.halt_reason).toMatch(/max_retries_per_task=1/);
  });

  it('halts the request when the report it must record the objection on is missing, and creates nothing in its place', async () => {
    const w = makeWorld(atFinalGateState(), []);

    const env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_corrective_requested', '--reason', OPERATOR_REASON,
    ]);

    expect(env.ok).toBe(false);
    expect(env.error?.message).toContain(REPORT_PATH);
    expect(fs.existsSync(path.join(w.projectDir, REPORT_PATH))).toBe(false);
    const onDisk = readState(w.projectDir);
    expect(onDisk.graph.nodes.final_review.corrective_tasks ?? []).toHaveLength(0);
    expect(onDisk.graph.nodes.final_review.status).toBe('completed');
  });

  it('halts the request when the final review node names no report at all', async () => {
    const w = makeWorld(atFinalGateState({ doc_path: null }));

    const env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_corrective_requested', '--reason', OPERATOR_REASON,
    ]);

    expect(env.ok).toBe(false);
    expect(readText(w.projectDir, REPORT_PATH)).toBe(REVIEW_REPORT);
  });

  it('rejects a request carrying no objection', async () => {
    const w = makeWorld(atFinalGateState());

    const env = await signal(w.projectDir, w.configPath, ['--event', 'final_corrective_requested']);

    expect(env.ok).toBe(false);
    expect(readText(w.projectDir, REPORT_PATH)).toBe(REVIEW_REPORT);
    expect(readState(w.projectDir).graph.nodes.final_review.corrective_tasks ?? []).toHaveLength(0);
  });
});

describe('final_corrective_requested — where the report append commits', () => {
  it('leaves the report untouched when the post-mutation validation rejects the run', async () => {
    // A corrective entry numbered out of sequence: the mutation applies, and
    // the validation that follows it rejects the whole run. Nothing may reach
    // disk — not the state, and not the operator's finding.
    const corrupt = { ...spentCorrective(1), index: 7 };
    const w = makeWorld(atFinalGateState({ corrective_tasks: [corrupt] }));
    const stateBefore = readText(w.projectDir, 'state.json');

    const env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_corrective_requested', '--reason', OPERATOR_REASON,
    ]);

    expect(env.ok).toBe(false);
    expect(readText(w.projectDir, REPORT_PATH)).toBe(REVIEW_REPORT);
    expect(readText(w.projectDir, 'state.json')).toBe(stateBefore);
  });

  it('appends once when the state write is lost after the report write and the operator re-signals', async () => {
    const w = makeWorld(atFinalGateState());
    const stateBefore = readText(w.projectDir, 'state.json');

    let env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_corrective_requested', '--reason', OPERATOR_REASON,
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    expect(occurrences(readText(w.projectDir, REPORT_PATH), OPERATOR_REASON)).toBe(1);

    // Simulate a crash between the two writes: the report carries the finding,
    // the state never learned about the corrective. Re-signalling is the
    // recovery, and it must complete the birth without a second finding.
    fs.writeFileSync(path.join(w.projectDir, 'state.json'), stateBefore, 'utf8');

    env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_corrective_requested', '--reason', OPERATOR_REASON,
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    expect((env.data as { action: string }).action).toBe('execute_task');

    expect(occurrences(readText(w.projectDir, REPORT_PATH), OPERATOR_REASON)).toBe(1);
    const host = readState(w.projectDir).graph.nodes.final_review;
    expect(host.corrective_tasks).toHaveLength(1);
    expect(host.corrective_tasks[0].reason).toBe(OPERATOR_REASON);
  });
});
