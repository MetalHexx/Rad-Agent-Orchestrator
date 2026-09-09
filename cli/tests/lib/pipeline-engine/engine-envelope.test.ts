import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  __setActionEventsRootForTests,
  attachPromptIfActionResolved,
  processEvent,
} from '../../../src/lib/pipeline-engine/engine.js';
import type { PipelineTemplate } from '../../../src/lib/pipeline-engine/types.js';
import { makeTestIO, seedCatalog, seedTemplate } from '../../helpers/engine-test-bench.js';
import { driveTwoRepoFinalCorrective, driveTwoRepoTaskCorrective } from './fixtures/corrective-helpers.js';
import { PROJECT_DIR as PARITY_PROJECT_DIR, TEST_PATH_CONTEXT } from './fixtures/parity-states.js';

describe('success envelope carries top-level data.prompt, data.completion_event and data.completion_commands', () => {
  it('populates prompt with composed catalog text, completion_event with the resolved event name, and a runnable command for it', () => {
    const bench = seedCatalog({
      'action.spawn_planner.md': {
        frontmatter: {
          kind: 'action', name: 'spawn_planner', title: 't', description: 'd',
          category: 'agent-spawn', completion_event: 'requirements_completed',
        },
        body: 'BODY-FROM-CATALOG',
      },
      'event.requirements_completed.md': {
        frontmatter: {
          kind: 'event', name: 'requirements_completed', title: 't', description: 'd',
          signal_payload: {},
        },
        body: 'EVENT-BODY',
      },
    });
    const tpl = seedTemplate({ firstAction: 'spawn_planner' });
    const io = makeTestIO({ catalog: bench.root, template: tpl });

    const result = processEvent('start', bench.projectDir, {}, io, bench.pathContext);
    expect(result.action).toBe('spawn_planner');
    expect(result.prompt).toContain('BODY-FROM-CATALOG');
    expect(result.prompt).toContain('`completion_commands`');
    expect(result.completion_event).toBe('requirements_completed');
    expect(result.completion_commands).toEqual([
      {
        event: 'requirements_completed',
        command: `node "${bench.pathContext.scriptPath}" pipeline signal `
          + `--event requirements_completed --project-dir "${path.resolve(bench.projectDir)}"`,
      },
    ]);
  });

  it('omits prompt, completion_event and completion_commands on failure envelopes', () => {
    const result = processEvent(
      'unknown_event',
      '/nonexistent',
      {},
      makeTestIO({ stateMissing: true }),
      { scriptsDir: '/x', templatesDir: '/x', scriptPath: '/x/radorch.mjs' },
    );
    expect(result.error).toBeDefined();
    expect(result.prompt).toBeUndefined();
    expect(result.completion_event).toBeUndefined();
    expect(result.completion_commands).toBeUndefined();
  });
});

/**
 * R6 — a flag that will never have a value for this invocation is dropped from
 * the command, not rendered as a `<fill-in: …>` marker the orchestrator would
 * have to decide against the standing "never drop anything" rule.
 *
 * Driven against the repo's own catalog (so the real `task_completed`
 * declaration order and item_keys apply) with the exact enriched contexts each
 * scope produces. One case per column of the R6 flag matrix, including the
 * task-corrective negative control — over-omission still yields a clean-looking
 * command, so the cases that assert a flag SURVIVES matter as much as the ones
 * that assert it goes.
 */
describe('completion_commands drop contextually inapplicable flags (R6)', () => {
  const REPO_ACTION_EVENTS_DIR = path.resolve(
    __dirname, '..', '..', '..', '..', 'runtime-config', 'action-events',
  );
  beforeEach(() => { __setActionEventsRootForTests(REPO_ACTION_EVENTS_DIR); });
  afterEach(() => { __setActionEventsRootForTests(null); });

  const SCRIPT_PATH = path.join('/opt', 'radorch', 'radorch.mjs');
  const PROJECT_DIR = path.join('/tmp', 'r6-project');
  const REPO_NAMES = ['fake-api', 'fake-ui'];

  const REPOS_SKELETON =
    `--repos '[{"name":"fake-api","committed":<fill-in: committed>,`
    + `"commitHash":<fill-in: commitHash>,"pushed":<fill-in: pushed>},`
    + `{"name":"fake-ui","committed":<fill-in: committed>,`
    + `"commitHash":<fill-in: commitHash>,"pushed":<fill-in: pushed>}]'`;

  function envelope(context: Record<string, unknown>, action = 'execute_task') {
    const result = attachPromptIfActionResolved(
      { action, context },
      // Unread by this helper — the composed prompt comes from the catalog.
      {} as unknown as PipelineTemplate,
      'task_gate_approved',
      PROJECT_DIR,
      SCRIPT_PATH,
      REPO_NAMES,
    );
    expect(result.completion_commands).toHaveLength(1);
    return result;
  }

  function commandFor(context: Record<string, unknown>, action = 'execute_task'): string {
    return envelope(context, action).completion_commands![0].command;
  }

  function flagsOf(command: string): string[] {
    return [...command.matchAll(/(?:^| )--([a-z-]+)/g)].map(m => m[1]);
  }

  const NORMAL = { phase_number: 1, phase_id: 'P01', task_number: 2, task_id: 'P01-T02', should_commit: true };

  it('renders a normal commit task unchanged — every flag either filled or a marker', () => {
    expect(commandFor(NORMAL)).toBe(
      `node "${SCRIPT_PATH}" pipeline signal --event task_completed `
      + `--project-dir "${path.resolve(PROJECT_DIR)}" `
      + `--phase 1 --task 2 --branch "<fill-in: branch>" ${REPOS_SKELETON}`,
    );
  });

  it('drops --task but keeps --phase on a phase-scope corrective', () => {
    const command = commandFor({
      phase_number: 3, phase_id: 'P03', task_number: null, task_id: 'P03-PHASE', should_commit: true,
    });
    expect(flagsOf(command)).toEqual(['event', 'project-dir', 'phase', 'branch', 'repos']);
    expect(command).toContain('--phase 3');
    expect(command).not.toContain('<fill-in: task>');
  });

  it('drops both identity flags on a final-scope corrective', () => {
    const command = commandFor({
      phase_number: null, phase_id: null, task_number: null, task_id: 'FINAL', should_commit: true,
    });
    expect(flagsOf(command)).toEqual(['event', 'project-dir', 'branch', 'repos']);
    expect(command).not.toContain('<fill-in: phase>');
    expect(command).not.toContain('<fill-in: task>');
  });

  it('drops --branch and --repos when the task was not directed to commit', () => {
    // The widest case: `source_control.auto_commit: never` applies to every task
    // of such a project, corrective or not.
    const command = commandFor({ ...NORMAL, should_commit: false });
    expect(flagsOf(command)).toEqual(['event', 'project-dir', 'phase', 'task']);
    expect(command).not.toContain('fake-api');
  });

  it('says nothing in the prompt about a flag it dropped', () => {
    const noCommit = envelope({ ...NORMAL, should_commit: false });
    expect(noCommit.prompt).not.toMatch(/^- `--(branch|repos)`/m);
    // Silent omission — no note explaining the absence, and no stale array note.
    expect(noCommit.prompt).not.toContain('One object per repo');
    expect(noCommit.prompt).not.toContain('do not edit, add, or remove one');

    // The flags that survived still get their bullets.
    const normal = envelope(NORMAL);
    expect(normal.prompt).toMatch(/^- `--branch`/m);
    expect(normal.prompt).toMatch(/^- `--repos`/m);
  });

  it('omits nothing for an action whose context carries no should_commit', () => {
    // `should_commit` is an execute_task-only field. A strict `=== false` check
    // keeps every other action's required flags intact.
    const command = commandFor({ phase_number: 1, phase_id: 'P01', task_number: 2, task_id: 'P01-T02' });
    expect(flagsOf(command)).toEqual(['event', 'project-dir', 'phase', 'task', 'branch', 'repos']);
  });

  // The review-spawn actions carry the same identity the engine already resolved
  // for the task being reviewed. Before their events declared `phase`/`task`,
  // the rendered command carried `--doc-path` alone and the engine had to
  // auto-resolve identity on the way back in — which the review doc's own
  // frontmatter could pre-empt. These cases pin the identity onto the command.
  describe('review-completion events carry the identity the engine already resolved', () => {
    const REVIEW_SCOPE = { phase_number: 1, phase_id: 'P01', task_number: 2, task_id: 'P01-T02' };

    it('renders --phase and --task as bare literals on a normal-scope code review', () => {
      const result = envelope(REVIEW_SCOPE, 'spawn_code_reviewer');
      expect(result.completion_event).toBe('code_review_completed');
      expect(result.completion_commands![0].command).toBe(
        `node "${SCRIPT_PATH}" pipeline signal --event code_review_completed `
        + `--project-dir "${path.resolve(PROJECT_DIR)}" `
        + `--doc-path "<fill-in: doc-path>" --phase 1 --task 2`,
      );
      // Already final, so neither flag is a marker and neither earns a bullet —
      // only `--doc-path` is still the orchestrator's to fill.
      expect(result.prompt).not.toMatch(/^- `--(phase|task)`/m);
      expect(result.prompt).toMatch(/^- `--doc-path`/m);
    });

    it('drops --task but keeps --phase on a phase-scope corrective code review', () => {
      const command = commandFor({
        phase_number: 3, phase_id: 'P03', task_number: null, task_id: 'P03-PHASE',
      }, 'spawn_code_reviewer');
      expect(flagsOf(command)).toEqual(['event', 'project-dir', 'doc-path', 'phase']);
      expect(command).toContain('--phase 3');
      expect(command).not.toContain('<fill-in: task>');
    });

    it('drops both identity flags on a final-scope corrective code review', () => {
      const command = commandFor({
        phase_number: null, phase_id: null, task_number: null, task_id: 'FINAL',
      }, 'spawn_code_reviewer');
      expect(flagsOf(command)).toEqual(['event', 'project-dir', 'doc-path']);
      expect(command).not.toContain('<fill-in: phase>');
      expect(command).not.toContain('<fill-in: task>');
    });

    it('renders --phase on a phase review', () => {
      const result = envelope({
        phase_number: 2, phase_id: 'P02', task_number: null, task_id: 'P02-PHASE',
      }, 'spawn_phase_reviewer');
      expect(result.completion_event).toBe('phase_review_completed');
      expect(result.completion_commands![0].command).toBe(
        `node "${SCRIPT_PATH}" pipeline signal --event phase_review_completed `
        + `--project-dir "${path.resolve(PROJECT_DIR)}" `
        + `--doc-path "<fill-in: doc-path>" --phase 2`,
      );
      expect(result.prompt).not.toMatch(/^- `--phase`/m);
    });
  });

  // The cases above hand `attachPromptIfActionResolved` its context directly, so
  // on their own they prove only that a given context renders correctly — not
  // that enrichment produces that context, nor that the engine feeds the
  // enriched one to the renderer. These two drive real state through
  // `processEvent` end to end, and bracket the range: one corrective scope that
  // omits nothing, one that omits both identity flags.
  describe('driven end to end through processEvent', () => {
    it('keeps both identity flags for a task-scope corrective (negative control)', () => {
      // A task-scope corrective is hosted BY a task iteration and resolves to
      // that iteration's real index, so nothing is inapplicable. This is the
      // case an over-general "correctives have no task number" would break —
      // and it would still produce a clean, parseable command.
      const result = processEvent('start', PARITY_PROJECT_DIR, {}, driveTwoRepoTaskCorrective(), TEST_PATH_CONTEXT);
      expect(result.action).toBe('execute_task');
      const command = result.completion_commands![0].command;
      expect(command).toContain('--phase 1 --task 1 ');
      expect(command).toContain('--branch "<fill-in: branch>"');
      expect(command).toContain('"name":"fake-api"');
    });

    it('drops both identity flags for a final-scope corrective', () => {
      const result = processEvent('start', PARITY_PROJECT_DIR, {}, driveTwoRepoFinalCorrective(), TEST_PATH_CONTEXT);
      expect(result.action).toBe('execute_task');
      const command = result.completion_commands![0].command;
      expect(command).not.toContain('--phase');
      expect(command).not.toContain('--task');
      // Commit is on for this fixture, so these two must survive as markers.
      expect(command).toContain('--branch "<fill-in: branch>"');
      expect(command).toContain('"name":"fake-api"');
    });
  });
});
