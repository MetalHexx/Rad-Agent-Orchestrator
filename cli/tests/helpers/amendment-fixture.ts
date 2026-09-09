/**
 * amendment-fixture.ts
 *
 * Builds a real project directory for the amendment suites: a Master Plan, a
 * Requirements doc, the phase and task documents explosion emits, and a v6
 * state.json seeded from them and then shaped into a chosen frontier position.
 *
 * The documents and the seeded iterations come from `explodeMasterPlan` itself, so
 * a fixture is what a project actually looks like rather than a hand-written
 * approximation of one — which matters most for the invariant suite, whose whole
 * subject is that already-run content survives an amendment untouched.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { explodeMasterPlan } from '../../src/lib/explode-master-plan.js';

export const PROJECT = 'DEMO';
export const NOW = '2026-08-25T09:00:00.000Z';
const CREATED = '2026-08-01T00:00:00.000Z';

export const MASTER_PLAN = [
  '---',
  'project: DEMO',
  'type: master_plan',
  'status: approved',
  'created: "2026-08-01"',
  'repos: [alpha, beta]',
  'total_phases: 3',
  'total_tasks: 4',
  '---',
  '',
  '# DEMO — Master Plan',
  '',
  '## Introduction',
  '',
  'A small plan, carried here so an amendment has real frozen text to preserve.',
  '',
  '## Execution Map',
  '',
  '**P01 · First** · repos: alpha · order: T01 → T02',
  '',
  '| Task | Repo | Complexity | Purpose |',
  '|---|---|---|---|',
  '| T01 | alpha | standard | Lay the foundation. |',
  '| T02 | alpha | simple | Wire the seam. |',
  '',
  '**P02 · Second** · repos: beta · order: T01',
  '',
  '| Task | Repo | Complexity | Purpose |',
  '|---|---|---|---|',
  '| T01 | beta | standard | Serve the reader. |',
  '',
  '**P03 · Third** · repos: beta · order: T01',
  '',
  '| Task | Repo | Complexity | Purpose |',
  '|---|---|---|---|',
  '| T01 | beta | complex | Close the loop. |',
  '',
  '## P01: First',
  '',
  '**Intent**',
  'The foundation exists.',
  '',
  '### P01-T01: Lay the foundation',
  '',
  'Lay the foundation.',
  '',
  '**Task type:** code',
  '**Complexity:** standard',
  '**Target repo:** alpha',
  '',
  '### P01-T02: Wire the seam',
  '',
  'Wire the seam.',
  '',
  '**Task type:** code',
  '**Complexity:** simple',
  '**Target repo:** alpha',
  '',
  '## P02: Second',
  '',
  '**Intent**',
  'The reader is served.',
  '',
  '### P02-T01: Serve the reader',
  '',
  'Serve the reader.',
  '',
  '**Task type:** code',
  '**Complexity:** standard',
  '**Target repo:** beta',
  '',
  '## P03: Third',
  '',
  '**Intent**',
  'The loop closes.',
  '',
  '### P03-T01: Close the loop',
  '',
  'Close the loop.',
  '',
  '**Task type:** code',
  '**Complexity:** complex',
  '**Target repo:** beta',
  '',
].join('\n');

/** The same document as a Windows editor would have left it. */
export function withCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

export const REQUIREMENTS = [
  '---',
  'project: DEMO',
  'type: requirements',
  '---',
  '',
  '# DEMO — Requirements',
  '',
  '## Functional',
  '',
  '- The system carries the reader from end to end.',
  '',
].join('\n');

export const RATIONALE = 'The operator found work the original plan did not carry.';

// ── Amendment documents ──────────────────────────────────────────────────────

export function amendmentDoc(opts: {
  index: number;
  addsPhases?: string[];
  addsTasks: string[];
  /** Task ids restated in full at their existing id. */
  revisesTasks?: string[];
  /** Task ids removed; no block accompanies them, so `blocks` need not mention them. */
  dropsTasks?: string[];
  /** Phase ids the amendment's drops empty. */
  dropsPhases?: string[];
  blocks: string[];
}): string {
  return [
    '---',
    'project: DEMO',
    'type: amendment',
    `amendment: ${opts.index}`,
    'created: "2026-08-25"',
    ...(opts.addsPhases === undefined ? [] : [`adds_phases: [${opts.addsPhases.join(', ')}]`]),
    `adds_tasks: [${opts.addsTasks.join(', ')}]`,
    ...(opts.revisesTasks === undefined ? [] : [`revises_tasks: [${opts.revisesTasks.join(', ')}]`]),
    ...(opts.dropsTasks === undefined ? [] : [`drops_tasks: [${opts.dropsTasks.join(', ')}]`]),
    ...(opts.dropsPhases === undefined ? [] : [`drops_phases: [${opts.dropsPhases.join(', ')}]`]),
    '---',
    '',
    '## Rationale',
    '',
    RATIONALE,
    '',
    '## Amendment Blocks',
    '',
    ...opts.blocks,
    '',
  ].join('\n');
}

export function taskBlock(anchor: string, title: string, repo: string, complexity = 'standard'): string[] {
  return [
    `### ${anchor}: ${title}`,
    '',
    `${title}, in full.`,
    '',
    '**Task type:** code',
    `**Complexity:** ${complexity}`,
    `**Target repo:** ${repo}`,
    '',
  ];
}

/** Appends a fourth phase — legal against every frontier position, frozen or not. */
export const APPENDS_A_PHASE = amendmentDoc({
  index: 1,
  addsPhases: ['P04'],
  addsTasks: ['P04-T01', 'P04-T02'],
  blocks: [
    '## P04: Follow on',
    '',
    '**Intent**',
    'The follow-on capability exists.',
    '',
    ...taskBlock('P04-T01', 'Build the follow on', 'alpha'),
    ...taskBlock('P04-T02', 'Verify the follow on', 'beta', 'simple'),
  ],
});

/** Adds a second task to the running phase — legal only while P02 is still soft. */
export const ADDS_A_TASK = amendmentDoc({
  index: 1,
  addsTasks: ['P02-T02'],
  blocks: [
    '## P02: Second',
    '',
    '**Intent**',
    'The reader is served, and now audited too.',
    '',
    ...taskBlock('P02-T02', 'Audit the reader', 'beta'),
  ],
});

/** Revises the sole not-started task — legal only while P03 has not begun. */
export const REVISES_A_TASK = amendmentDoc({
  index: 1,
  addsTasks: [],
  revisesTasks: ['P03-T01'],
  blocks: [
    '## P03: Third',
    '',
    ...taskBlock('P03-T01', 'Close the loop for good', 'beta', 'complex'),
  ],
});

/** Inserts a phase ahead of the running one, displacing everything after it. */
export const INSERTS_A_PHASE = amendmentDoc({
  index: 1,
  addsPhases: ['P02'],
  addsTasks: ['P02-T01'],
  blocks: [
    '## P02: Interlude',
    '',
    '**Intent**',
    'A step the plan skipped.',
    '',
    ...taskBlock('P02-T01', 'Fill the gap', 'beta'),
  ],
});

// ── State shaping ────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

/** The four review-intensity templates a project can run. */
export type Tier = 'low' | 'medium' | 'high' | 'extra-high';

export const TIERS: Tier[] = ['low', 'medium', 'high', 'extra-high'];

/** The tiers whose template puts a review and gate beside each phase's task loop. */
const PHASE_REVIEW_TIERS = new Set<Tier>(['medium', 'extra-high']);

/** The tiers whose template puts a review and gate on every task. */
const TASK_REVIEW_TIERS = new Set<Tier>(['high', 'extra-high']);

export interface PhaseProfile {
  status: string;
  tasks: string[];
  /** The `task_loop` container's own status; defaults to the phase's. */
  taskLoop?: string;
  /** Status of the phase's review and gate on a tier that declares them. */
  review?: string;
}

/** P01 done, P02 running with its only task finished, P03 untouched. */
export const MID_PHASE: PhaseProfile[] = [
  { status: 'completed', tasks: ['completed', 'completed'], review: 'completed' },
  { status: 'in_progress', tasks: ['completed'], taskLoop: 'completed', review: 'not_started' },
  { status: 'not_started', tasks: ['not_started'], review: 'not_started' },
];

/** Every phase finished — the shape a project parked at the final gate carries. */
export const ALL_PHASES_DONE: PhaseProfile[] = [
  { status: 'completed', tasks: ['completed', 'completed'], review: 'completed' },
  { status: 'completed', tasks: ['completed'], review: 'completed' },
  { status: 'completed', tasks: ['completed'], review: 'completed' },
];

/** A coder could not proceed inside P02 — a halt an amendment must refuse. */
export const HALTED_MID_PLAN: PhaseProfile[] = [
  { status: 'completed', tasks: ['completed', 'completed'], review: 'completed' },
  { status: 'in_progress', tasks: ['halted'], review: 'not_started' },
  { status: 'not_started', tasks: ['not_started'], review: 'not_started' },
];

export interface FixtureOptions {
  /** The review-intensity template the project runs, which decides which review and
   *  gate nodes its iterations carry: `low` none, `medium` a phase review and gate,
   *  `high` a review and gate on every task, `extra-high` both sets. */
  tier?: Tier;
  phases?: PhaseProfile[];
  phaseLoop?: string;
  /** Where the walker's cursor sits. Defaults to the coarse `phase_loop` id, which is
   *  what a project carries before it has entered the loop. */
  currentNodePath?: string;
  graphStatus?: string;
  currentTier?: string;
  haltReason?: string | null;
  finalReview?: Json;
  finalApprovalGate?: Json;
  /** Seeds `plan_approval_gate`. Absent by default — most fixtures start already
   *  past plan approval, so the node is omitted entirely rather than defaulted. */
  planApprovalGate?: Json;
  prGate?: Json;
  /** Present only once the PR conditional's branch has been taken. */
  finalPr?: Json;
  /** Top-level node ids to delete from `state.graph.nodes` after seeding — the
   *  shape an older per-project snapshot carries when it predates a node the
   *  current template declares. */
  omitNodes?: string[];
  masterPlan?: string;
  /** A Master Plan swapped onto disk once the state has been seeded from `masterPlan`.
   *  Explosion refuses a plan whose task numbering does not restart at T01 in every
   *  phase, so a fixture reproducing the projects that were exploded before that guard
   *  existed has to seed from a conforming plan and substitute the real one afterwards.
   *  Give it the same phase and task counts as `masterPlan`, or the seeded iterations
   *  will not line up with it. */
  masterPlanAfterExplode?: string;
  requirements?: string;
  amendment?: string;
  amendmentFileName?: string;
}

export interface Fixture {
  projectDir: string;
  projectName: string;
  masterPlanPath: string;
  requirementsPath: string;
  amendmentPath: string;
  statePath: string;
  state(): Json;
  masterPlan(): string;
}

function repo(name: string): Json {
  return { name, branch: 'radorch/demo', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null };
}

function seedState(projectName: string, opts: FixtureOptions): Json {
  const nodes: Json = {
    master_plan: { kind: 'step', status: 'completed', doc_path: `${projectName}-MASTER-PLAN.md`, retries: 0 },
    requirements: { kind: 'step', status: 'completed', doc_path: `${projectName}-REQUIREMENTS.md`, retries: 0 },
    explode_master_plan: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
    phase_loop: { kind: 'for_each_phase', status: 'not_started', iterations: [] },
    final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0, ...(opts.finalReview ?? {}) },
    pr_gate: { kind: 'conditional', status: 'not_started', branch_taken: null, ...(opts.prGate ?? {}) },
    final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false, ...(opts.finalApprovalGate ?? {}) },
  };
  if (opts.finalPr !== undefined) {
    nodes['final_pr'] = { kind: 'step', status: 'completed', doc_path: null, retries: 0, ...opts.finalPr };
  }
  if (opts.planApprovalGate !== undefined) {
    nodes['plan_approval_gate'] = { kind: 'gate', status: 'not_started', gate_active: false, ...opts.planApprovalGate };
  }
  for (const id of opts.omitNodes ?? []) {
    delete nodes[id];
  }

  return {
    $schema: 'orchestration-state-v6',
    project: { name: projectName, created: CREATED, updated: CREATED },
    config: {
      gate_mode: 'ask',
      limits: { max_retries_per_task: 3 },
      source_control: { auto_commit: 'always', auto_pr: 'always' },
    },
    pipeline: {
      gate_mode: null,
      source_control: {
        worktree_name: 'demo',
        repos: [repo('alpha'), repo('beta')],
        auto_commit: 'always',
        auto_pr: 'always',
      },
      current_tier: opts.currentTier ?? 'execution',
      halt_reason: opts.haltReason ?? null,
    },
    graph: {
      template_id: opts.tier ?? 'medium',
      status: opts.graphStatus ?? 'in_progress',
      current_node_path: opts.currentNodePath ?? 'phase_loop',
      nodes,
    },
  };
}

/**
 * Walk the iterations explosion seeded and give them the run history the profile
 * describes: per-task executor nodes, and — on a tier that declares them — a review
 * and gate on each task and beside each `task_loop`.
 */
function shapeIterations(state: Json, opts: FixtureOptions): void {
  const profiles = opts.phases ?? MID_PHASE;
  const tier = opts.tier ?? 'medium';
  const graph = state['graph'] as Json;
  const phaseLoop = (graph['nodes'] as Json)['phase_loop'] as Json;
  phaseLoop['status'] = opts.phaseLoop ?? 'in_progress';

  const iterations = phaseLoop['iterations'] as Json[];
  iterations.forEach((iteration, i) => {
    const profile = profiles[i];
    if (profile === undefined) throw new Error(`amendment-fixture: no profile for phase iteration ${i}`);
    iteration['status'] = profile.status;

    const nodes = iteration['nodes'] as Json;
    const taskLoop = nodes['task_loop'] as Json;
    taskLoop['status'] = profile.taskLoop ?? profile.status;
    (taskLoop['iterations'] as Json[]).forEach((task, j) => {
      const status = profile.tasks[j];
      if (status === undefined) throw new Error(`amendment-fixture: no status for task iteration ${i}.${j}`);
      task['status'] = status;
      const taskNodes: Json = { task_executor: { kind: 'step', status, doc_path: task['doc_path'], retries: 0 } };
      if (TASK_REVIEW_TIERS.has(tier)) {
        // A task's review runs after its executor, so it stands where the executor
        // left it: judged once the task finished, unrun otherwise.
        const reviewed = status === 'completed' ? 'completed' : 'not_started';
        taskNodes['code_review'] = { kind: 'step', status: reviewed, doc_path: null, retries: 0, verdict: reviewed === 'completed' ? 'approved' : null };
        taskNodes['task_gate'] = { kind: 'gate', status: reviewed, gate_active: false };
      }
      task['nodes'] = taskNodes;
    });

    if (PHASE_REVIEW_TIERS.has(tier)) {
      const status = profile.review ?? 'not_started';
      nodes['phase_review'] = { kind: 'step', status, doc_path: null, retries: 0, verdict: status === 'completed' ? 'approved' : null };
      nodes['phase_gate'] = { kind: 'gate', status, gate_active: false };
    }
  });
}

/**
 * Write a project to a fresh temp directory and return its paths.
 *
 * The amendment document is written whether or not the test applies it; a fixture
 * with no `amendment` carries the append-a-phase one, which is legal at every
 * frontier position.
 */
export function makeProject(opts: FixtureOptions = {}): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amend-'));
  const projectDir = path.join(root, PROJECT);
  fs.mkdirSync(projectDir);

  const masterPlanPath = path.join(projectDir, `${PROJECT}-MASTER-PLAN.md`);
  const requirementsPath = path.join(projectDir, `${PROJECT}-REQUIREMENTS.md`);
  fs.writeFileSync(masterPlanPath, opts.masterPlan ?? MASTER_PLAN, 'utf8');
  fs.writeFileSync(requirementsPath, opts.requirements ?? REQUIREMENTS, 'utf8');

  const statePath = path.join(projectDir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify(seedState(PROJECT, opts), null, 2), 'utf8');

  explodeMasterPlan({ projectDir, masterPlanPath, projectName: PROJECT, nowIso: CREATED });

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Json;
  shapeIterations(state, opts);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

  // The substitution lands after the seed, so everything downstream — the merge's own
  // re-parse of `masterPlanPath` included — reads the substituted plan.
  if (opts.masterPlanAfterExplode !== undefined) {
    fs.writeFileSync(masterPlanPath, opts.masterPlanAfterExplode, 'utf8');
  }

  const amendmentPath = path.join(projectDir, opts.amendmentFileName ?? `${PROJECT}-AMENDMENT-01.md`);
  fs.writeFileSync(amendmentPath, opts.amendment ?? APPENDS_A_PHASE, 'utf8');

  return {
    projectDir,
    projectName: PROJECT,
    masterPlanPath,
    requirementsPath,
    amendmentPath,
    statePath,
    state: () => JSON.parse(fs.readFileSync(statePath, 'utf8')) as Json,
    masterPlan: () => fs.readFileSync(masterPlanPath, 'utf8'),
  };
}

/** The phase iterations of a state object, in order. */
export function phaseIterations(state: Json): Json[] {
  const nodes = (state['graph'] as Json)['nodes'] as Json;
  return (nodes['phase_loop'] as Json)['iterations'] as Json[];
}

/** The task iterations of one phase iteration, in order. */
export function taskIterations(phase: Json): Json[] {
  const taskLoop = (phase['nodes'] as Json)['task_loop'] as Json;
  return (taskLoop['iterations'] as Json[]) ?? [];
}

export function graphNode(state: Json, id: string): Json | undefined {
  return ((state['graph'] as Json)['nodes'] as Json)[id] as Json | undefined;
}
