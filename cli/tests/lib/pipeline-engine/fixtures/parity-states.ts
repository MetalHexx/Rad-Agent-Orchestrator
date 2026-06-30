import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processEvent } from '../../../../src/lib/pipeline-engine/engine.js';
import type {
  PathContext,
  PipelineState,
  OrchestrationConfig,
  IOAdapter,
  PipelineResult,
  StepNodeState,
  ForEachPhaseNodeState,
  ForEachTaskNodeState,
} from '../../../../src/lib/pipeline-engine/types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR = '/tmp/test-project/PARITY-TEST';
// Retained for external callers that still resolve the install dir against this
// constant; post-P06-T01 it is no longer surfaced through the typed config.
export const ORCH_ROOT = path.resolve(__dirname, '../../../../..');

// Shared PathContext for every test that invokes `processEvent` or
// `enrichActionContext`. Built from this fixture file's own location
// (`tests/lib/pipeline-engine/fixtures/`) so it works in source-mode (vitest/tsx) without
// depending on the engine's bundled output geometry.
// scriptsDir is the engine source folder; templatesDir resolves via ORCH_ROOT
// (5 levels up from fixtures/ to the repo root) → runtime-config/templates/.
const FIXTURE_SCRIPTS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'src', 'lib', 'pipeline-engine');
export const TEST_PATH_CONTEXT: PathContext = {
  scriptsDir: FIXTURE_SCRIPTS_DIR,
  templatesDir: path.resolve(ORCH_ROOT, 'runtime-config', 'templates'),
};

export const DEFAULT_CONFIG: OrchestrationConfig = {
  limits: {
    max_retries_per_task: 2,
    max_consecutive_review_rejections: 3,
  },
  human_gates: {
    after_planning: true,
    execution_mode: 'ask',
    after_final_review: true,
  },
  source_control: {
    auto_commit: 'ask',
    auto_pr: 'ask',
  },
  default_template: 'extra-high',
};

// Map of doc_path → document content used by mock readDocument
export const DOC_STORE: Record<string, { frontmatter: Record<string, unknown>; content: string }> = {};

// ── Mock IOAdapter factory ────────────────────────────────────────────────────

export type MockIO = IOAdapter & {
  currentState: PipelineState | null;
  writeCalls: Array<{ projectDir: string; state: PipelineState }>;
  ensureDirCalls: string[];
};

export function createMockIO(initialState: PipelineState | null = null): MockIO {
  let currentState = initialState ? structuredClone(initialState) : null;
  const writeCalls: Array<{ projectDir: string; state: PipelineState }> = [];
  const ensureDirCalls: string[] = [];

  return {
    get currentState() {
      return currentState;
    },
    writeCalls,
    ensureDirCalls,
    readState(_projectDir: string): PipelineState | null {
      return currentState ? structuredClone(currentState) : null;
    },
    writeState(_projectDir: string, state: PipelineState): void {
      currentState = structuredClone(state);
      writeCalls.push({ projectDir: _projectDir, state: structuredClone(state) });
    },
    readConfig(_configPath?: string): OrchestrationConfig {
      return structuredClone(DEFAULT_CONFIG);
    },
    readDocument(docPath: string): { frontmatter: Record<string, unknown>; content: string } | null {
      return DOC_STORE[docPath.replace(/\\/g, '/')] ?? null;
    },
    ensureDirectories(projectDir: string): void {
      ensureDirCalls.push(projectDir);
    },
  };
}

// ── Scaffold helper ───────────────────────────────────────────────────────────

export function createScaffoldedState(): PipelineState {
  const io = createMockIO(null);
  processEvent('start', PROJECT_DIR, {}, io, TEST_PATH_CONTEXT);
  return io.currentState!;
}

// ── Seed document helper ──────────────────────────────────────────────────────

export function seedDoc(docPath: string, extraFrontmatter: Record<string, unknown> = {}): void {
  DOC_STORE[docPath.replace(/\\/g, '/')] = {
    frontmatter: {
      title: path.basename(docPath, path.extname(docPath)),
      status: 'completed',
      ...extraFrontmatter,
    },
    content: `# ${path.basename(docPath)}`,
  };
}

// ── Complete planning steps helper ────────────────────────────────────────────

const PLANNING_STEP_ORDER = ['requirements', 'master_plan', 'explode_master_plan'] as const;

export function completePlanningSteps(state: PipelineState, through: string): void {
  const throughIndex = PLANNING_STEP_ORDER.indexOf(through as (typeof PLANNING_STEP_ORDER)[number]);
  if (throughIndex === -1) {
    throw new Error(`Unknown planning step: ${through}`);
  }
  for (let i = 0; i <= throughIndex; i++) {
    const step = PLANNING_STEP_ORDER[i];
    const node = state.graph.nodes[step] as StepNodeState;
    if (node) {
      node.status = 'completed';
      node.doc_path = `/tmp/${step}.md`;
    }
  }
}

// ── Config factory ────────────────────────────────────────────────────────────

export function createConfig(overrides: {
  human_gates?: Partial<OrchestrationConfig['human_gates']>;
  source_control?: Partial<OrchestrationConfig['source_control']>;
  limits?: Partial<OrchestrationConfig['limits']>;
}): OrchestrationConfig {
  return {
    limits: { ...DEFAULT_CONFIG.limits, ...overrides.limits },
    human_gates: { ...DEFAULT_CONFIG.human_gates, ...overrides.human_gates },
    source_control: { ...DEFAULT_CONFIG.source_control, ...overrides.source_control },
    default_template: DEFAULT_CONFIG.default_template,
  };
}

// ── Mock IOAdapter with config override ───────────────────────────────────────

export function createMockIOWithConfig(
  initialState: PipelineState | null,
  config: OrchestrationConfig,
): MockIO {
  let currentState = initialState ? structuredClone(initialState) : null;
  const writeCalls: Array<{ projectDir: string; state: PipelineState }> = [];
  const ensureDirCalls: string[] = [];

  return {
    get currentState() {
      return currentState;
    },
    writeCalls,
    ensureDirCalls,
    readState(_projectDir: string): PipelineState | null {
      return currentState ? structuredClone(currentState) : null;
    },
    writeState(_projectDir: string, state: PipelineState): void {
      currentState = structuredClone(state);
      writeCalls.push({ projectDir: _projectDir, state: structuredClone(state) });
    },
    readConfig(_configPath?: string): OrchestrationConfig {
      return structuredClone(config);
    },
    readDocument(docPath: string): { frontmatter: Record<string, unknown>; content: string } | null {
      return DOC_STORE[docPath.replace(/\\/g, '/')] ?? null;
    },
    ensureDirectories(projectDir: string): void {
      ensureDirCalls.push(projectDir);
    },
  };
}

// ── Shared task/doc-path helpers ───────────────────────────────────────────────

export const TASKS_2 = [
  { id: 'T01', title: 'Task 1' },
  { id: 'T02', title: 'Task 2' },
];

export const phasePlanDoc = (phase: number): string =>
  path.posix.join(PROJECT_DIR, 'phases', `phase-${phase}-plan.md`);
export const taskHandoffDoc = (phase: number, task: number): string =>
  path.posix.join(PROJECT_DIR, 'tasks', `p${phase}-t${task}-handoff.md`);
export const codeReviewDoc = (phase: number, task: number): string =>
  path.posix.join(PROJECT_DIR, 'tasks', `p${phase}-t${task}-review.md`);
export const phaseReviewDoc = (phase: number): string =>
  path.posix.join(PROJECT_DIR, 'phases', `phase-${phase}-review.md`);

// ── Explosion-state seeding (mirrors Iter 5's explosion-script post-condition) ─

const TASK_FIXTURES = [
  { id: 'T01', title: 'Task 1' },
  { id: 'T02', title: 'Task 2' },
  { id: 'T03', title: 'Task 3' },
  { id: 'T04', title: 'Task 4' },
  { id: 'T05', title: 'Task 5' },
  { id: 'T06', title: 'Task 6' },
];

/**
 * Pre-seeds each phase iteration with `doc_path = phasePlanDoc(n)` and a
 * scaffolded `task_loop` child; each task iteration carries
 * `doc_path = taskHandoffDoc(p, t)` directly. Body nodes are not scaffolded;
 * the walker scaffolds them on first in_progress transition.
 *
 * PRECONDITION: The phase_loop must already be expanded with iterations, and
 * each iteration's `nodes.task_loop` must already be scaffolded. This is
 * guaranteed by walker-driven expansion (e.g., after `plan_approved` event).
 * Call this helper only after such expansion; failing to do so will result in
 * `Cannot read properties of undefined` errors on iteration access.
 *
 * `tasksPerPhase` defaults to 2 — the shape most integration tests expect.
 * Tests that exercise single-task gate behavior pass `1` explicitly.
 */
export function seedExplosionStateFor(
  io: MockIO,
  totalPhases: number,
  tasksPerPhase = 2,
): void {
  if (tasksPerPhase < 1 || tasksPerPhase > TASK_FIXTURES.length) {
    throw new Error(
      `seedExplosionStateFor: tasksPerPhase must be between 1 and ${TASK_FIXTURES.length}, got ${tasksPerPhase}`,
    );
  }
  const tasks = TASK_FIXTURES.slice(0, tasksPerPhase);
  const phaseLoop = io.currentState!.graph.nodes['phase_loop'] as ForEachPhaseNodeState;

  // Validate precondition: phase_loop must have iterations and each must have task_loop scaffolded.
  if (!phaseLoop?.iterations?.length || phaseLoop.iterations.length < totalPhases) {
    throw new Error(
      `seedExplosionStateFor: phase_loop must have at least ${totalPhases} iterations ` +
      `(has ${phaseLoop?.iterations?.length ?? 0}). Call this helper AFTER walker-driven ` +
      `expansion (e.g., processEvent('plan_approved', ...)) which pre-seeds iterations and ` +
      `nodes.task_loop per the template body.`,
    );
  }

  for (let pIdx = 0; pIdx < totalPhases; pIdx++) {
    const phaseNum = pIdx + 1;
    const phaseDoc = phasePlanDoc(phaseNum);
    seedDoc(phaseDoc, { tasks });

    const phaseIter = phaseLoop.iterations[pIdx];
    phaseIter.doc_path = phaseDoc;

    // Validate that task_loop exists on this phase iteration.
    if (!phaseIter.nodes['task_loop']) {
      throw new Error(
        `seedExplosionStateFor: phase iteration ${pIdx} missing 'task_loop' node. ` +
        `Ensure walker expansion (e.g., processEvent('plan_approved', ...)) has run before calling.`,
      );
    }

    const taskLoop = phaseIter.nodes['task_loop'] as ForEachTaskNodeState;
    taskLoop.iterations = tasks.map((_, tIdx) => {
      const handoffDoc = taskHandoffDoc(phaseNum, tIdx + 1);
      seedDoc(handoffDoc);
      return {
        index: tIdx,
        status: 'not_started' as const,
        nodes: {},
        corrective_tasks: [],
        doc_path: handoffDoc,
        repos: [{ name: 'rad-orc-source', commit_hash: null }],
      };
    });
  }
}

// ── Drive to execution tier helper ────────────────────────────────────────────

/**
 * Scaffolds state, completes planning, seeds master plan, approves plan, and
 * mirrors the Iter 5 explosion-script seeding so the walker can advance into
 * the execution tier without phase_planning / task_handoff authoring events.
 * Returns MockIO positioned at the execution tier.
 *
 * `tasksPerPhase` defaults to 2 — the shape most integration tests expect.
 * Tests that exercise single-task gate behavior pass `1` explicitly.
 */
export function driveToExecutionWithConfig(
  config: OrchestrationConfig,
  totalPhases = 1,
  tasksPerPhase = 2,
): MockIO {
  const io = createMockIOWithConfig(null, config);
  processEvent('start', PROJECT_DIR, {}, io, TEST_PATH_CONTEXT);
  const state = io.currentState!;
  completePlanningSteps(state, 'explode_master_plan');
  const mpDoc = (state.graph.nodes['master_plan'] as StepNodeState).doc_path!;
  seedDoc(mpDoc, {
    total_phases: totalPhases,
    total_tasks: totalPhases * tasksPerPhase,
  });
  const result = processEvent('plan_approved', PROJECT_DIR, { doc_path: mpDoc }, io, TEST_PATH_CONTEXT);

  // gate_mode_selection fires ask_gate_mode for ask configs.
  // Pass through by setting a gate mode, then reset so subsequent gates still see ask behavior.
  if (result.action === 'ask_gate_mode') {
    processEvent('gate_mode_set', PROJECT_DIR, { gate_mode: 'task' }, io, TEST_PATH_CONTEXT);
    io.currentState!.pipeline.gate_mode = null;
  }

  // Mirror the production handshake: `source_control_init` must fire before the
  // walker first evaluates commit_gate / pr_gate (which now read state_ref).
  // Resolve auto_commit / auto_pr from the caller's config, mapping `ask` → `always`
  // so integration tests that leave them at the default still fire the gate's true
  // branch (matching pre-state-ref semantics where `"ask" !== "never"`).
  // Tests exercising the false branch supply `never` explicitly.
  initSourceControlForTests(io, config);

  // Mirror Iter 5's explosion seeding then re-walk so subsequent events see
  // a state shape consistent with post-explosion production.
  seedExplosionStateFor(io, totalPhases, tasksPerPhase);
  processEvent('start', PROJECT_DIR, {}, io, TEST_PATH_CONTEXT);

  return io;
}

/**
 * Initialize pipeline.source_control for integration tests whose walker will
 * evaluate commit_gate / pr_gate (state_ref: pipeline.source_control.*).
 *
 * Previously fired source_control_init to seed this state; now that the event
 * and its mutation are retired (P04-T03, FR-6), we write directly to state.
 *
 * Normalization mirrors the pre-state-ref behavior of `config_ref`: any value
 * other than the canonical `"never" | "no"` is treated as `"always"` so that
 * commit_gate / pr_gate's `neq "never"` predicate fires. Previously tests that
 * left `auto_commit` at the `"ask"` default relied on `config_ref` reading it
 * literally — `"ask" !== "never"` → commit step fires. The normalization
 * preserves that semantics under state_ref.
 */
export function initSourceControlForTests(io: MockIO, config: OrchestrationConfig): void {
  const toNormalized = (raw: string | undefined): 'always' | 'never' => {
    const v = (raw ?? '').trim().toLowerCase();
    return v === 'never' || v === 'no' ? 'never' : 'always';
  };
  if (!io.currentState) return;
  const patched = structuredClone(io.currentState);
  patched.pipeline.source_control = {
    worktree_name: 'PARITY-TEST',
    auto_commit: toNormalized(config.source_control.auto_commit),
    auto_pr: toNormalized(config.source_control.auto_pr),
    repos: [
      {
        name: 'rad-orc-source',
        branch: 'feature/test-branch',
        base_branch: 'main',
        remote_url: null,
        compare_url: null,
        pr_url: null,
      },
    ],
  };
  io.writeState(PROJECT_DIR, patched);
}

// ── Drive single task helper ──────────────────────────────────────────────────

/**
 * Drives a single task through execute → review (approve). Post-Iter 7 the
 * task_handoff authoring step is gone — the pre-seeded `task_handoff` child
 * already carries `status: completed` + `doc_path`.
 */
export function driveTaskWith(io: MockIO, phase: number, task: number): PipelineResult {
  const ctx = { phase, task };
  // Per FR-11, `_started` events are no longer accepted. The optimistic write
  // in processEvent (FR-10) transitions step nodes to in_progress without
  // needing an explicit signal, so the drive helper dispatches only the
  // completion events.
  processEvent('task_completed', PROJECT_DIR, ctx, io, TEST_PATH_CONTEXT);
  const reviewDoc = codeReviewDoc(phase, task);
  seedDoc(reviewDoc);
  let result = processEvent('code_review_completed', PROJECT_DIR, {
    ...ctx,
    doc_path: reviewDoc,
    verdict: 'approved',
  }, io, TEST_PATH_CONTEXT);

  // If commit conditional fires, drive commit events at task scope
  if (result.action === 'invoke_source_control_commit') {
    result = processEvent('commit_completed', PROJECT_DIR, ctx, io, TEST_PATH_CONTEXT);
  }

  // If task gate fires, approve it to continue (matches drivePhaseReviewApproval pattern)
  if (result.action === 'gate_task') {
    result = processEvent('task_gate_approved', PROJECT_DIR, ctx, io, TEST_PATH_CONTEXT);
  }

  return result;
}

// ── Drive phase review approval helper ────────────────────────────────────────

/**
 * Drives phase review + gate approval to phase completion.
 * Post-Iter 8: phase_review absorbed phase_report; only one doc emitted.
 */
export function drivePhaseReviewApproval(io: MockIO, phase: number): PipelineResult {
  // Per FR-11, `phase_review_started` is gone; the optimistic write in
  // processEvent (FR-10) handles the in_progress transition.
  seedDoc(phaseReviewDoc(phase));
  let result = processEvent('phase_review_completed', PROJECT_DIR, {
    phase, doc_path: phaseReviewDoc(phase), verdict: 'approved', exit_criteria_met: true,
  }, io, TEST_PATH_CONTEXT);

  // If phase gate fires, approve it to reach commit conditional
  if (result.action === 'gate_phase') {
    result = processEvent('phase_gate_approved', PROJECT_DIR, { phase }, io, TEST_PATH_CONTEXT);
  }

  return result;
}

// ── Drive to review tier helper ───────────────────────────────────────────────

/**
 * Drives the pipeline from scaffold through one phase (two tasks) to the review
 * tier. Handles gate approvals and commit steps based on the provided config.
 * Returns MockIO positioned at the review tier (ready for final_review tests).
 */
export function driveToReviewTier(config: OrchestrationConfig): MockIO {
  const io = createMockIOWithConfig(null, config);
  processEvent('start', PROJECT_DIR, {}, io, TEST_PATH_CONTEXT);

  const state = io.currentState!;
  completePlanningSteps(state, 'explode_master_plan');
  const mpDoc = (state.graph.nodes['master_plan'] as StepNodeState).doc_path!;
  seedDoc(mpDoc, { total_phases: 1, total_tasks: 2 });

  const planResult = processEvent('plan_approved', PROJECT_DIR, { doc_path: mpDoc }, io, TEST_PATH_CONTEXT);

  // Pass through gate_mode_selection if present (ask mode)
  if (planResult.action === 'ask_gate_mode') {
    processEvent('gate_mode_set', PROJECT_DIR, { gate_mode: 'task' }, io, TEST_PATH_CONTEXT);
    io.currentState!.pipeline.gate_mode = null;
  }

  // commit_gate / pr_gate now read state_ref; init before the walker evaluates them.
  initSourceControlForTests(io, config);

  // Mirror Iter 5's explosion-script seeding (phase_planning + task_handoff
  // child nodes pre-completed) and re-walk to advance into the execution tier.
  seedExplosionStateFor(io, 1, 2);
  processEvent('start', PROJECT_DIR, {}, io, TEST_PATH_CONTEXT);

  // Drive two tasks (post-Iter 7: no task_handoff events; handoff is pre-seeded).
  // Per FR-11, `_started` events were removed; optimistic in_progress writes
  // (FR-10) cover the transition.
  for (const t of [1, 2]) {
    const ctx = { phase: 1, task: t };
    processEvent('task_completed', PROJECT_DIR, ctx, io, TEST_PATH_CONTEXT);
    const crDoc = path.join(PROJECT_DIR, 'tasks', `p1-t${t}-review.md`);
    seedDoc(crDoc);
    let result = processEvent('code_review_completed', PROJECT_DIR, {
      ...ctx, doc_path: crDoc, verdict: 'approved',
    }, io, TEST_PATH_CONTEXT);

    // If commit conditional fires, drive commit events at task scope
    if (result.action === 'invoke_source_control_commit') {
      result = processEvent('commit_completed', PROJECT_DIR, ctx, io, TEST_PATH_CONTEXT);
    }

    // If task gate fires (e.g., ask mode), approve it
    if (result.action === 'gate_task') {
      processEvent('task_gate_approved', PROJECT_DIR, ctx, io, TEST_PATH_CONTEXT);
    }
  }

  // Phase review (post-Iter 8: phase_report absorbed into phase_review).
  // Per FR-11, `phase_review_started` is gone; the optimistic write in
  // processEvent (FR-10) handles the in_progress transition.
  const prvDoc = path.join(PROJECT_DIR, 'phases', 'phase-1-review.md');
  seedDoc(prvDoc);
  let result: PipelineResult = processEvent('phase_review_completed', PROJECT_DIR, {
    phase: 1, doc_path: prvDoc, verdict: 'approved', exit_criteria_met: true,
  }, io, TEST_PATH_CONTEXT);

  // If phase gate fires, approve it
  if (result.action === 'gate_phase') {
    result = processEvent('phase_gate_approved', PROJECT_DIR, { phase: 1 }, io, TEST_PATH_CONTEXT);
  }

  return io;
}
