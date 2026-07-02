// cli/tests/behavioral/pipeline/events/corrective-advance.behavioral.test.ts
//
// Full-engine-flow coverage for corrective task advancement
// (signal → mutation → pre-walk validate → walkDAG → recompute → post-walk validate).
//
// Regression guard: the `current_node_path` honesty tripwire used to run at the
// PRE-walk validate (before the cursor is recomputed), so completing a
// corrective's child node — which leaves the corrective ENTRY in_progress with
// no in_progress child leaf, a state for which deriveCurrentNodePathFromMarkers
// returns the non-null entry path — spuriously disagreed with the stale cursor
// and rejected the mutation. The fix gates that check to the post-walk validate
// only. These tests prove BOTH phase-level and task-level correctives advance
// end-to-end through the real signal entry.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, afterEach, beforeEach, expect } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEnvelopeAction } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// Synthetic execution template: task body is task_gate → task_executor →
// code_review. findTaskLoopBodyDefs mirrors this body into corrective entries
// (both phase- and task-scope), so a corrective walks the same three nodes.
const EXEC_TEMPLATE_BODY = `template:
  id: syn-exec
  version: "1.0.0"
  description: "Synthetic execution template for behavioral tests"
nodes:
  - id: gate_mode_selection
    kind: gate
    label: "Gate Mode Selection"
    mode_ref: human_gates.execution_mode
    action_if_needed: gate_task
    approved_event: gate_mode_set
    auto_approve_modes: [task, phase, autonomous]
    depends_on: []
  - id: phase_loop
    kind: for_each_phase
    label: "Phase Execution Loop"
    source_doc_ref: "$.nodes.master_plan.doc_path"
    total_field: total_phases
    depends_on: [gate_mode_selection]
    body:
      - id: task_loop
        kind: for_each_task
        label: "Task Execution Loop"
        source_doc_ref: "$.current_phase.doc_path"
        tasks_field: tasks
        depends_on: []
        body:
          - id: task_gate
            kind: gate
            label: "Task Gate"
            mode_ref: human_gates.execution_mode
            action_if_needed: gate_task
            approved_event: task_gate_approved
            auto_approve_modes: [phase, autonomous]
            depends_on: []
          - id: task_executor
            kind: step
            label: "Execute Task"
            action: execute_task
            events: { completed: task_completed }
            depends_on: [task_gate]
          - id: code_review
            kind: step
            label: "Code Review"
            action: spawn_code_reviewer
            events: { completed: code_review_completed }
            doc_output_field: doc_path
            depends_on: [task_executor]
      - id: phase_gate
        kind: gate
        label: "Phase Gate"
        mode_ref: human_gates.execution_mode
        action_if_needed: gate_phase
        approved_event: phase_gate_approved
        auto_approve_modes: [task, autonomous]
        depends_on: [task_loop]
      - id: phase_review
        kind: step
        label: "Phase Review"
        action: spawn_phase_reviewer
        events: { completed: phase_review_completed }
        doc_output_field: doc_path
        depends_on: [phase_gate]
  - id: final_review
    kind: step
    label: "Final Review"
    action: spawn_final_reviewer
    events: { completed: final_review_completed }
    doc_output_field: doc_path
    depends_on: [phase_loop]
  - id: final_approval_gate
    kind: gate
    label: "Final Approval Gate"
    mode_ref: human_gates.after_final_review
    action_if_needed: request_final_approval
    approved_event: final_approved
    auto_approve_modes: []
    depends_on: [final_review]
`;

// ── Node builders (schema-conformant v6 shapes) ──────────────────────────────
const step = (status: string) => ({ kind: 'step', status, doc_path: null, retries: 0 });
const gate = (status: string, gate_active: boolean) => ({ kind: 'gate', status, gate_active });

/** Corrective body nodes mirroring the task body. */
function correctiveNodes(taskExecutor: string, codeReview: string) {
  return {
    task_gate: gate('completed', true),
    task_executor: step(taskExecutor),
    code_review: step(codeReview),
  };
}

/** Build a full v6 state with the project frame shared across these tests. */
function baseState(currentNodePath: string, phaseIteration: Record<string, unknown>) {
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
        repos: [
          { name: 'rad-orc-source', branch: 'feature/syn', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
        ],
      },
      current_tier: 'execution',
      halt_reason: null,
    },
    graph: {
      template_id: 'syn-exec',
      status: 'in_progress',
      current_node_path: currentNodePath,
      nodes: {
        gate_mode_selection: gate('completed', false),
        phase_loop: { kind: 'for_each_phase', status: 'in_progress', iterations: [phaseIteration] },
        final_review: step('not_started'),
        final_approval_gate: gate('not_started', false),
      },
    },
  };
}

/** A completed original task body (the work that ran before a corrective). */
function completedTaskIteration(commitHash: string | null) {
  return {
    index: 0, status: 'completed', doc_path: null,
    repos: [{ name: 'backend', commit_hash: commitHash }],
    corrective_tasks: [],
    nodes: {
      task_gate: gate('completed', true),
      task_executor: step('completed'),
      code_review: step('completed'),
    },
  };
}

// Original scope docs seeded on the hosting iterations. Under the raw-verdict
// contract a born corrective copies its hosting iteration's doc_path (the
// ORIGINAL phase plan / task handoff), so these must be non-empty — an empty
// scope doc is an engine invariant violation that the mutation throws on.
const PHASE_PLAN_DOC = 'phases/p1-plan.md';
const TASK_HANDOFF_DOC = 'tasks/p1-t1.md';

// ── Phase-scope corrective states ────────────────────────────────────────────
function phaseCorrectiveState(cursor: string, nodes: Record<string, unknown>, repos = [{ name: 'backend', commit_hash: null }]) {
  return baseState(cursor, {
    index: 0, status: 'in_progress', doc_path: PHASE_PLAN_DOC, repos: [],
    corrective_tasks: [
      { index: 1, reason: 'phase review requested changes', injected_after: 'phase_review', status: 'in_progress', doc_path: PHASE_PLAN_DOC, repos, nodes },
    ],
    nodes: {
      task_loop: { kind: 'for_each_task', status: 'completed', iterations: [completedTaskIteration('aaa1111')] },
      phase_gate: gate('completed', false),
      phase_review: step('completed'),
    },
  });
}

// ── Task-scope corrective state ───────────────────────────────────────────────
function taskCorrectiveState(cursor: string, nodes: Record<string, unknown>) {
  const taskIter = completedTaskIteration('aaa1111');
  (taskIter as Record<string, unknown>).status = 'in_progress';
  (taskIter as Record<string, unknown>).doc_path = TASK_HANDOFF_DOC;
  (taskIter as Record<string, unknown>).corrective_tasks = [
    { index: 1, reason: 'code review requested changes', injected_after: 'code_review', status: 'in_progress', doc_path: TASK_HANDOFF_DOC, repos: [{ name: 'backend', commit_hash: null }], nodes },
  ];
  return baseState(cursor, {
    index: 0, status: 'in_progress', doc_path: null, repos: [],
    corrective_tasks: [],
    nodes: {
      task_loop: { kind: 'for_each_task', status: 'in_progress', iterations: [taskIter] },
      phase_gate: gate('not_started', false),
      phase_review: step('not_started'),
    },
  });
}

async function signal(projectDir: string, configPath: string, argv: string[]) {
  return captureEnvelope(async () => {
    await runCommand(pipelineSignalCommand, {
      argv: [...argv, '--project-dir', projectDir, '--config', configPath],
      env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: projectDir },
      isTTY: false, stderr: process.stderr,
    });
  });
}

function makeWorld(state: unknown, sideFiles: Array<{ path: string; contents: string }> = []) {
  const w = buildWorld({
    template: { id: 'syn-exec', body: EXEC_TEMPLATE_BODY },
    state: state as Parameters<typeof buildWorld>[0]['state'],
    config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'autonomous', after_final_review: true } },
    sideFiles,
  });
  cleanups.push(w.cleanup);
  return w;
}

function readState(projectDir: string) {
  return JSON.parse(fs.readFileSync(path.join(projectDir, 'state.json'), 'utf8'));
}

describe('corrective task advancement — full engine flow', () => {
  it('phase-corrective task_completed records the per-corrective hash and advances to code review without tripping the cursor tripwire (regression)', async () => {
    const w = makeWorld(phaseCorrectiveState(
      'phase_loop[0].corrective_tasks[1].task_executor',
      correctiveNodes('in_progress', 'not_started'),
    ));
    // task_completed carries the coder's per-repo commit result + branch and
    // advances to code review; the hash is recorded before the reviewer runs.
    const env = await signal(w.projectDir, w.configPath, ['--event', 'task_completed', '--phase', '1', '--task', '1',
      '--repos', JSON.stringify([{ name: 'backend', committed: true, commitHash: 'cor1234', pushed: true }]), '--branch', 'feature/syn']);

    expect(env.ok, env.error?.message).toBe(true);
    expect((env.data as { action: string }).action).toBe('spawn_code_reviewer');
    const onDisk = readState(w.projectDir);
    expect(onDisk.graph.current_node_path).toBe('phase_loop[0].corrective_tasks[1].code_review');
    const corrective = onDisk.graph.nodes.phase_loop.iterations[0].corrective_tasks[0];
    expect(corrective.nodes.task_executor.status).toBe('completed');
    expect(corrective.nodes.code_review.status).toBe('in_progress');
    // task_completed records the per-corrective commit hash.
    expect(corrective.repos[0].commit_hash).toBe('cor1234');
    assertPromptForEnvelopeAction(env);
  });

  it('task-corrective task_completed records the per-corrective hash and advances to code review without tripping the cursor tripwire', async () => {
    const w = makeWorld(taskCorrectiveState(
      'phase_loop[0].task_loop[0].corrective_tasks[1].task_executor',
      correctiveNodes('in_progress', 'not_started'),
    ));
    const env = await signal(w.projectDir, w.configPath, ['--event', 'task_completed', '--phase', '1', '--task', '1',
      '--repos', JSON.stringify([{ name: 'backend', committed: true, commitHash: 'cor1234', pushed: true }]), '--branch', 'feature/syn']);

    expect(env.ok, env.error?.message).toBe(true);
    expect((env.data as { action: string }).action).toBe('spawn_code_reviewer');
    const onDisk = readState(w.projectDir);
    expect(onDisk.graph.current_node_path).toBe('phase_loop[0].task_loop[0].corrective_tasks[1].code_review');
    const corrective = onDisk.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].corrective_tasks[0];
    expect(corrective.nodes.task_executor.status).toBe('completed');
    expect(corrective.nodes.code_review.status).toBe('in_progress');
    // task_completed records the per-corrective commit hash.
    expect(corrective.repos[0].commit_hash).toBe('cor1234');
    assertPromptForEnvelopeAction(env);
  });
});

// ── Corrective-of-a-corrective: superseded parent finalization ────────────────
// Full-engine-flow regression for the HICCUP-TEST bug: a corrective's own code
// review returns changes_requested and births a successor corrective. The
// superseded parent corrective must be finalized to `completed` at birth so it
// is never stranded at in_progress inside a later-completed iteration (which the
// dashboard rendered as a perpetual "Coding" spinner). Driving
// code_review_completed with a raw `changes_requested` verdict births the
// successor; the born corrective carries its hosting iteration's ORIGINAL scope
// doc, not an orchestrator-authored handoff path.

const PHASE_C1_CR_DOC = 'reports/phase-c1-cr.md';
const PHASE_C1_CR_CONTENTS = `---\nverdict: changes_requested\n---\nPhase corrective C1 code review — requests further changes.\n`;
const PHASE_C2_CR_DOC = 'reports/phase-c2-cr.md';
const PHASE_C2_CR_APPROVED = `---\nverdict: approved\n---\nPhase corrective C2 code review — approved.\n`;
const PHASE_C2_HANDOFF = 'tasks/phase-c2.md';
const HANDOFF_STUB = `---\ntype: task_handoff\n---\nCorrective handoff stub.\n`;

const TASK_C1_CR_DOC = 'reports/task-c1-cr.md';
const TASK_C1_CR_CONTENTS = `---\nverdict: changes_requested\n---\nTask corrective C1 code review — requests further changes.\n`;
const TASK_C2_HANDOFF = 'tasks/task-c2.md';

describe('corrective-of-a-corrective — superseded parent finalization (full engine flow)', () => {
  it('phase scope: C1 code_review changes_requested finalizes C1 and births C2', async () => {
    const w = makeWorld(
      phaseCorrectiveState(
        'phase_loop[0].corrective_tasks[1].code_review',
        correctiveNodes('completed', 'in_progress'),
      ),
      [
        { path: PHASE_C1_CR_DOC, contents: PHASE_C1_CR_CONTENTS },
        { path: PHASE_C2_HANDOFF, contents: HANDOFF_STUB },
      ],
    );
    const reviewAbs = path.join(w.projectDir, PHASE_C1_CR_DOC);
    const env = await signal(w.projectDir, w.configPath, ['--event', 'code_review_completed', '--doc-path', reviewAbs, '--phase', '1', '--task', '1']);

    expect(env.ok, env.error?.message).toBe(true);
    const onDisk = readState(w.projectDir);
    const cts = onDisk.graph.nodes.phase_loop.iterations[0].corrective_tasks;
    expect(cts).toHaveLength(2);
    // The fix: parent corrective finalized to completed (was in_progress).
    expect(cts[0].status).toBe('completed');
    // Successor born and now active.
    expect(cts[1].index).toBe(2);
    expect(cts[1].injected_after).toBe('code_review');
    expect(cts[1].doc_path).toBe(PHASE_PLAN_DOC);
    expect(onDisk.graph.current_node_path).toMatch(/corrective_tasks\[2\]/);
    assertPromptForEnvelopeAction(env);
  });

  it('phase scope: runs to phase completion with NO corrective left in_progress (end-to-end regression)', async () => {
    const w = makeWorld(
      phaseCorrectiveState(
        'phase_loop[0].corrective_tasks[1].code_review',
        correctiveNodes('completed', 'in_progress'),
      ),
      [
        { path: PHASE_C1_CR_DOC, contents: PHASE_C1_CR_CONTENTS },
        { path: PHASE_C2_HANDOFF, contents: HANDOFF_STUB },
        { path: PHASE_C2_CR_DOC, contents: PHASE_C2_CR_APPROVED },
      ],
    );
    const c1ReviewAbs = path.join(w.projectDir, PHASE_C1_CR_DOC);
    const c2ReviewAbs = path.join(w.projectDir, PHASE_C2_CR_DOC);

    // 1. C1 review requests changes → C2 born, C1 finalized.
    let env = await signal(w.projectDir, w.configPath, ['--event', 'code_review_completed', '--doc-path', c1ReviewAbs, '--phase', '1', '--task', '1']);
    expect(env.ok, env.error?.message).toBe(true);
    // 2. Drive C2's body to completion: task_completed (with commit result) → code_review(approved).
    env = await signal(w.projectDir, w.configPath, ['--event', 'task_completed', '--phase', '1', '--task', '1',
      '--repos', JSON.stringify([{ name: 'backend', committed: true, commitHash: 'c2hash1', pushed: true }]), '--branch', 'feature/syn']);
    expect(env.ok, env.error?.message).toBe(true);
    env = await signal(w.projectDir, w.configPath, ['--event', 'code_review_completed', '--doc-path', c2ReviewAbs, '--phase', '1', '--task', '1']);
    expect(env.ok, env.error?.message).toBe(true);

    const onDisk = readState(w.projectDir);
    const phaseIter = onDisk.graph.nodes.phase_loop.iterations[0];
    expect(phaseIter.status).toBe('completed');
    const cts = phaseIter.corrective_tasks;
    expect(cts).toHaveLength(2);
    // The exact HICCUP-TEST symptom, now impossible: no corrective stranded in_progress.
    expect(cts.every((ct: { status: string }) => ct.status === 'completed')).toBe(true);
    expect(cts.some((ct: { status: string }) => ct.status === 'in_progress')).toBe(false);
  });

  it('task scope: C1 code_review changes_requested finalizes C1 and births C2', async () => {
    const w = makeWorld(
      taskCorrectiveState(
        'phase_loop[0].task_loop[0].corrective_tasks[1].code_review',
        correctiveNodes('completed', 'in_progress'),
      ),
      [
        { path: TASK_C1_CR_DOC, contents: TASK_C1_CR_CONTENTS },
        { path: TASK_C2_HANDOFF, contents: HANDOFF_STUB },
      ],
    );
    const reviewAbs = path.join(w.projectDir, TASK_C1_CR_DOC);
    const env = await signal(w.projectDir, w.configPath, ['--event', 'code_review_completed', '--doc-path', reviewAbs, '--phase', '1', '--task', '1']);

    expect(env.ok, env.error?.message).toBe(true);
    const onDisk = readState(w.projectDir);
    const cts = onDisk.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].corrective_tasks;
    expect(cts).toHaveLength(2);
    // The fix: parent task corrective finalized to completed (was in_progress).
    expect(cts[0].status).toBe('completed');
    expect(cts[1].index).toBe(2);
    expect(cts[1].injected_after).toBe('code_review');
    expect(cts[1].doc_path).toBe(TASK_HANDOFF_DOC);
    expect(onDisk.graph.current_node_path).toMatch(/task_loop\[0\]\.corrective_tasks\[2\]/);
    assertPromptForEnvelopeAction(env);
  });
});

// ── Corrective close finalizes unreached body gates as `skipped` (state hygiene) ──
// When a corrective closes an iteration, body nodes ordered AFTER the review node
// (phase_gate after phase_review, task_gate after code_review in the real
// templates) are never walked and would otherwise strand at `not_started` inside
// a `completed` iteration. The walker sweeps them to `skipped`. These seed the
// trailing gate as not_started (the real stranding shape) and drive the
// corrective's code review to `approved` so the corrective-completion
// short-circuit fires.
describe('corrective close finalizes unreached body gates as skipped (state hygiene)', () => {
  const APPROVED_CR_DOC = 'reports/sweep-approved-cr.md';
  const APPROVED_CR = `---\nverdict: approved\n---\nCorrective approved.\n`;
  const hasNotStarted = (nodes: Record<string, { status: string }>) =>
    Object.values(nodes).some((n) => n.status === 'not_started');

  it('phase scope: closing a phase corrective sweeps the unreached phase_gate to skipped', async () => {
    const w = makeWorld(
      baseState('phase_loop[0].corrective_tasks[1].code_review', {
        index: 0, status: 'in_progress', doc_path: null, repos: [],
        corrective_tasks: [
          { index: 1, reason: 'phase review requested changes', injected_after: 'phase_review', status: 'in_progress', doc_path: null, repos: [{ name: 'backend', commit_hash: 'pcor1' }], nodes: correctiveNodes('completed', 'in_progress') },
        ],
        nodes: {
          task_loop: { kind: 'for_each_task', status: 'completed', iterations: [completedTaskIteration('aaa1111')] },
          phase_gate: gate('not_started', false),   // ordered after phase_review → stranded by the corrective close
          phase_review: step('completed'),
        },
      }),
      [{ path: APPROVED_CR_DOC, contents: APPROVED_CR }],
    );
    const env = await signal(w.projectDir, w.configPath, ['--event', 'code_review_completed', '--verdict', 'approved', '--doc-path', path.join(w.projectDir, APPROVED_CR_DOC), '--phase', '1', '--task', '1']);

    expect(env.ok, env.error?.message).toBe(true);
    const it = readState(w.projectDir).graph.nodes.phase_loop.iterations[0];
    expect(it.status).toBe('completed');
    expect(it.corrective_tasks[0].status).toBe('completed');
    expect(it.nodes.phase_gate.status).toBe('skipped');     // THE FIX — was not_started
    expect(hasNotStarted(it.nodes)).toBe(false);
  });

  it('task scope: closing a task corrective sweeps the unreached task_gate to skipped', async () => {
    const taskIter = {
      index: 0, status: 'in_progress', doc_path: null, repos: [{ name: 'backend', commit_hash: 'aaa1111' }],
      corrective_tasks: [
        { index: 1, reason: 'code review requested changes', injected_after: 'code_review', status: 'in_progress', doc_path: null, repos: [{ name: 'backend', commit_hash: 'tcor1' }], nodes: correctiveNodes('completed', 'in_progress') },
      ],
      nodes: { task_gate: gate('not_started', false), task_executor: step('completed'), code_review: step('completed') },
    };
    const w = makeWorld(
      baseState('phase_loop[0].task_loop[0].corrective_tasks[1].code_review', {
        index: 0, status: 'in_progress', doc_path: null, repos: [], corrective_tasks: [],
        nodes: {
          task_loop: { kind: 'for_each_task', status: 'in_progress', iterations: [taskIter] },
          phase_gate: gate('not_started', false),
          phase_review: step('not_started'),
        },
      }),
      [{ path: APPROVED_CR_DOC, contents: APPROVED_CR }],
    );
    const env = await signal(w.projectDir, w.configPath, ['--event', 'code_review_completed', '--verdict', 'approved', '--doc-path', path.join(w.projectDir, APPROVED_CR_DOC), '--phase', '1', '--task', '1']);

    expect(env.ok, env.error?.message).toBe(true);
    const taskIterOut = readState(w.projectDir).graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0];
    expect(taskIterOut.status).toBe('completed');
    expect(taskIterOut.corrective_tasks[0].status).toBe('completed');
    expect(taskIterOut.nodes.task_gate.status).toBe('skipped');   // THE FIX — was not_started
    expect(hasNotStarted(taskIterOut.nodes)).toBe(false);
  });

  it('normal (non-corrective) close does NOT skip the gate — it stays completed', async () => {
    // No corrective: the body is walked normally and the gate ends `completed`.
    // Proves the sweep fires only on the corrective-completion path.
    const taskIter = {
      index: 0, status: 'in_progress', doc_path: null, repos: [{ name: 'backend', commit_hash: 'n1' }],
      corrective_tasks: [],
      nodes: { task_gate: gate('completed', false), task_executor: step('completed'), code_review: step('in_progress') },
    };
    const w = makeWorld(
      baseState('phase_loop[0].task_loop[0].code_review', {
        index: 0, status: 'in_progress', doc_path: null, repos: [], corrective_tasks: [],
        nodes: {
          task_loop: { kind: 'for_each_task', status: 'in_progress', iterations: [taskIter] },
          phase_gate: gate('not_started', false),
          phase_review: step('not_started'),
        },
      }),
      [{ path: APPROVED_CR_DOC, contents: APPROVED_CR }],
    );
    const env = await signal(w.projectDir, w.configPath, ['--event', 'code_review_completed', '--verdict', 'approved', '--doc-path', path.join(w.projectDir, APPROVED_CR_DOC), '--phase', '1', '--task', '1']);

    expect(env.ok, env.error?.message).toBe(true);
    const taskIterOut = readState(w.projectDir).graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0];
    expect(taskIterOut.status).toBe('completed');
    expect(taskIterOut.nodes.task_gate.status).toBe('completed');   // unchanged — not swept to skipped
  });
});
