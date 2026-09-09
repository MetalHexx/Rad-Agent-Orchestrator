// cli/tests/behavioral/pipeline/helpers/drive.ts
//
// Data-mapped event-chain driver for behavioral tests against
// runtime-config/templates/extra-high.yml. One map entry per reachable
// step node; the firing loop is shared across all targets.
//
// Side-file seeding: driveToNode creates the minimal fixture documents that
// the engine's pre-read and DAG-walker document-expansion paths require. All
// documents are written into world.projectDir at well-known relative paths so
// event context doc_path values (e.g. 'REQUIREMENTS.md', 'MASTER-PLAN.md',
// 'PHASE-1.md') resolve against the project directory. The files are owned by
// the world cleanup; no extra teardown is needed here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processEvent } from '../../../../src/lib/pipeline-engine/engine.js';
import { readState, writeState, readConfig, readDocument, readDocumentRaw, writeDocument, ensureDirectories } from '../../../../src/lib/pipeline-engine/state-io.js';
import type { PipelineResult, EventContext, IOAdapter } from '../../../../src/lib/pipeline-engine/types.js';
import type { World } from './world.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolute path to runtime-config/templates/ resolved from this helper's location.
// The helper is at cli/tests/behavioral/pipeline/helpers/; five dirs up is the repo root.
const REAL_TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', 'runtime-config', 'templates');

export interface ChainStep {
  event: string;
  context: Partial<EventContext>;
}

// Special sentinel: a chain step whose event is '__seed_source_control' is not
// fired through processEvent. Instead the driveToNode loop intercepts it and
// writes pipeline.source_control directly to state.json, replicating what the
// retired source_control_init mutation used to do (P04-T03, FR-6).
// Context fields: auto_commit, auto_pr, branch, base_branch.
const SEED_SOURCE_CONTROL = '__seed_source_control';

// Each chain is the sequence of events that, when fired in order against a
// fresh extra-high world, leaves the engine resolved at the named target
// step. The final processEvent return for the LAST event in the chain is
// the value returned by driveToNode.
export const EVENT_CHAINS: Record<string, ChainStep[]> = {
  master_plan: [
    { event: 'start', context: {} },
  ],
  explode_master_plan: [
    { event: 'start', context: {} },
    { event: 'master_plan_completed', context: { doc_path: 'MASTER-PLAN.md' } },
  ],
  final_review: [
    // Reached after plan approval, gate-mode set, and a single phase + task
    // iteration is completed through phase_review and phase_gate.
    // source_control seed provides auto_commit=never so no commit happens on task_completed.
    { event: 'start', context: {} },
    { event: 'master_plan_completed', context: { doc_path: 'MASTER-PLAN.md' } },
    { event: 'explosion_completed', context: {} },
    { event: 'plan_approved', context: {} },
    { event: 'gate_mode_set', context: { gate_mode: 'autonomous' } },
    { event: SEED_SOURCE_CONTROL, context: { auto_commit: 'never', auto_pr: 'never', branch: 'feature/test', base_branch: 'main' } },
    { event: 'task_completed', context: { verdict: 'approved' } },
    { event: 'code_review_completed', context: { doc_path: 'CR.md', verdict: 'approved' } },
    { event: 'phase_review_completed', context: { doc_path: 'PR.md', verdict: 'approved' } },
  ],
  task_executor: [
    { event: 'start', context: {} },
    { event: 'master_plan_completed', context: { doc_path: 'MASTER-PLAN.md' } },
    { event: 'explosion_completed', context: {} },
    { event: 'plan_approved', context: {} },
    { event: 'gate_mode_set', context: { gate_mode: 'autonomous' } },
    // Seed source_control with auto_commit=never so no commit happens on task_completed.
    { event: SEED_SOURCE_CONTROL, context: { auto_commit: 'never', auto_pr: 'never', branch: 'feature/test', base_branch: 'main' } },
  ],
  code_review: [
    // Seed source_control with auto_commit=never so no commit happens on task_completed.
    { event: 'start', context: {} },
    { event: 'master_plan_completed', context: { doc_path: 'MASTER-PLAN.md' } },
    { event: 'explosion_completed', context: {} },
    { event: 'plan_approved', context: {} },
    { event: 'gate_mode_set', context: { gate_mode: 'autonomous' } },
    { event: SEED_SOURCE_CONTROL, context: { auto_commit: 'never', auto_pr: 'never', branch: 'feature/test', base_branch: 'main' } },
    { event: 'task_completed', context: { verdict: 'approved' } },
  ],
  phase_review: [
    // Seed source_control with auto_commit=never so no commit happens on task_completed.
    { event: 'start', context: {} },
    { event: 'master_plan_completed', context: { doc_path: 'MASTER-PLAN.md' } },
    { event: 'explosion_completed', context: {} },
    { event: 'plan_approved', context: {} },
    { event: 'gate_mode_set', context: { gate_mode: 'autonomous' } },
    { event: SEED_SOURCE_CONTROL, context: { auto_commit: 'never', auto_pr: 'never', branch: 'feature/test', base_branch: 'main' } },
    { event: 'task_completed', context: { verdict: 'approved' } },
    { event: 'code_review_completed', context: { doc_path: 'CR.md', verdict: 'approved' } },
  ],
  final_pr: [
    { event: 'start', context: {} },
    { event: 'master_plan_completed', context: { doc_path: 'MASTER-PLAN.md' } },
    { event: 'explosion_completed', context: {} },
    { event: 'plan_approved', context: {} },
    { event: 'gate_mode_set', context: { gate_mode: 'autonomous' } },
    // Seed source_control with auto_pr=always to trigger pr_gate conditional's true branch.
    { event: SEED_SOURCE_CONTROL, context: { auto_commit: 'never', auto_pr: 'always', branch: 'feature/test', base_branch: 'main' } },
    { event: 'task_completed', context: { verdict: 'approved' } },
    { event: 'code_review_completed', context: { doc_path: 'CR.md', verdict: 'approved' } },
    { event: 'phase_review_completed', context: { doc_path: 'PR.md', verdict: 'approved' } },
    { event: 'final_review_completed', context: { doc_path: 'FR.md', verdict: 'approved' } },
  ],
};

function makeFilesystemIO(): IOAdapter {
  return { readState, writeState, readConfig, readDocument, readDocumentRaw, writeDocument, ensureDirectories };
}

/**
 * Ensure the world's templatesDir has `extra-high.yml` so that the engine can
 * load it during `start` with state===null. `buildWorld` writes the template
 * body as `template.yml`; the engine for a brand-new project explicitly loads
 * from `templatesDir/<name>.yml` (bypassing the project-local `template.yml`
 * shortcut). We copy the file from the real runtime-config/templates/ directory
 * if it is not already present in the world's templatesDir.
 */
function ensureExtraHighInTemplatesDir(world: World): void {
  const dest = path.join(world.pathContext.templatesDir, 'extra-high.yml');
  if (!fs.existsSync(dest)) {
    const src = path.join(REAL_TEMPLATES_DIR, 'extra-high.yml');
    fs.copyFileSync(src, dest);
  }
}

/**
 * Seed the minimal fixture documents that the engine's pre-read and DAG-walker
 * expansion paths require. Written once into world.projectDir and owned by the
 * world's temp-dir cleanup.
 *
 * Required files and their minimal frontmatter:
 *   MASTER-PLAN.md    — total_phases + total_tasks validated by plan_approved;
 *                       also read by the for_each_phase walker to expand iterations
 *   PHASE-1.md        — tasks[] read by the for_each_task walker to expand iterations
 *   CR.md             — verdict validated by code_review_completed
 *   PR.md             — verdict + exit_criteria_met validated by phase_review_completed
 *   FR.md             — verdict validated by final_review_completed
 */
function seedFixtureDocs(projectDir: string): void {
  const write = (filename: string, content: string) => {
    const filePath = path.join(projectDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, 'utf8');
    }
  };

  // MASTER-PLAN.md: total_phases=1 and total_tasks=1 so the plan_approved
  // pre-read succeeds and the for_each_phase walker expands one iteration.
  // doc_path for the single phase iteration is written as PHASE-1.md.
  write('MASTER-PLAN.md', [
    '---',
    'total_phases: 1',
    'total_tasks: 1',
    '---',
    'Synthetic master plan for driveToNode chains.',
  ].join('\n') + '\n');

  // PHASE-1.md: one task entry so the for_each_task walker expands one
  // iteration inside the phase loop. The tasks[] array content is irrelevant
  // to the engine beyond array length.
  write('PHASE-1.md', [
    '---',
    'tasks:',
    '  - id: T01',
    '    title: Synthetic task 1',
    '---',
    'Synthetic phase plan for driveToNode chains.',
  ].join('\n') + '\n');

  write('CR.md', [
    '---',
    'verdict: approved',
    '---',
    'Synthetic code review for driveToNode chains.',
  ].join('\n') + '\n');

  write('PR.md', [
    '---',
    'verdict: approved',
    'exit_criteria_met: true',
    '---',
    'Synthetic phase review for driveToNode chains.',
  ].join('\n') + '\n');

  write('FR.md', [
    '---',
    'verdict: approved',
    '---',
    'Synthetic final review for driveToNode chains.',
  ].join('\n') + '\n');
}

/**
 * Patch state.json after explosion_completed to seed phase iteration doc_path
 * values. In production the explosion script pre-seeds iterations; in test
 * chains we approximate by writing PHASE-<N>.md paths so the for_each_task
 * walker can expand task iterations.
 *
 * Called after any chain step whose event is 'explosion_completed'. Only
 * patches top-level phase_loop iterations whose doc_path is null/undefined
 * so existing (non-null) values are preserved.
 */
function patchPhaseIterationDocPaths(projectDir: string): void {
  const stateFile = path.join(projectDir, 'state.json');
  if (!fs.existsSync(stateFile)) return;
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const phaseLoop = state?.graph?.nodes?.phase_loop;
  if (!phaseLoop || !Array.isArray(phaseLoop.iterations)) return;
  let patched = false;
  for (const iter of phaseLoop.iterations) {
    if (iter.doc_path === undefined || iter.doc_path === null) {
      iter.doc_path = `PHASE-${iter.index + 1}.md`;
      patched = true;
    }
  }
  if (patched) {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  }
}

/**
 * Seed pipeline.source_control directly into state.json. Called when a chain
 * step uses the SEED_SOURCE_CONTROL sentinel instead of the retired
 * source_control_init event (P04-T03, FR-6).
 */
function seedSourceControlState(projectDir: string, context: Partial<EventContext>): void {
  const stateFile = path.join(projectDir, 'state.json');
  if (!fs.existsSync(stateFile)) return;
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const branch = (context as Record<string, unknown>)['branch'] as string ?? 'feature/test';
  const base_branch = (context as Record<string, unknown>)['base_branch'] as string ?? 'main';
  state.pipeline.source_control = {
    worktree_name: state.project?.name ?? 'test',
    auto_commit: (context as Record<string, unknown>)['auto_commit'] ?? 'never',
    auto_pr: (context as Record<string, unknown>)['auto_pr'] ?? 'never',
    repos: [
      { name: 'rad-orc-source', branch, base_branch, remote_url: null, compare_url: null, pr_url: null },
    ],
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

export async function driveToNode(world: World, targetNodeId: keyof typeof EVENT_CHAINS): Promise<PipelineResult> {
  const chain = EVENT_CHAINS[targetNodeId];
  if (!chain) {
    throw new Error(`driveToNode: no chain registered for ${String(targetNodeId)}`);
  }
  // Ensure the engine can find extra-high.yml in the world's templatesDir for
  // the `start` event (state===null path in the engine always loads from
  // templatesDir/<name>.yml, not the project-local template.yml snapshot).
  ensureExtraHighInTemplatesDir(world);
  // Seed fixture documents required by pre-reads and walker document-expansion.
  // Written once; idempotent (skips files that already exist).
  seedFixtureDocs(world.projectDir);
  const io = makeFilesystemIO();
  let result!: PipelineResult;
  for (const step of chain) {
    if (step.event === SEED_SOURCE_CONTROL) {
      // Directly write source_control into state.json instead of firing the
      // retired source_control_init event (P04-T03, FR-6).
      seedSourceControlState(world.projectDir, step.context);
      continue;
    }
    result = processEvent(step.event, world.projectDir, step.context, io, world.pathContext, world.configPath);
    // After each event, patch any newly-created phase iteration doc_paths so
    // the for_each_task walker can expand task iterations. Idempotent: only
    // patches iterations whose doc_path is null or undefined.
    patchPhaseIterationDocPaths(world.projectDir);
  }
  return result;
}
