import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseActionEventFile } from '../../../src/lib/pipeline-engine/action-event-loader.js';
import type { ActionFrontmatter, EventFrontmatter } from '../../../src/lib/pipeline-engine/action-event-loader.js';
import { buildCompletionCommands } from '../../../src/lib/pipeline-engine/completion-commands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** Absolute path to `<repo>/runtime-config/action-events/`, resolved by
 *  walking up from this test file (cli/tests/lib/pipeline-engine/). */
const CATALOG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'runtime-config', 'action-events');

function actionText(extra: string[]): string {
  return [
    '---',
    'kind: action',
    'name: gate_task',
    'title: Task gate',
    'description: Present the task gate.',
    'category: gate',
    'completion_event: task_gate_approved',
    ...extra,
    '---',
    'Body here.',
    '',
  ].join('\n');
}

describe('parseActionEventFile', () => {
  it('parses a valid action file with all required fields', () => {
    const text = [
      '---',
      'kind: action',
      'name: spawn_planner',
      'title: Spawn planner',
      'description: Spawn the planner agent.',
      'category: agent-spawn',
      'completion_event: requirements_completed',
      '---',
      'Body here.',
      '',
    ].join('\n');
    const parsed = parseActionEventFile(text, 'action.spawn_planner.md');
    expect(parsed.kind).toBe('action');
    expect(parsed.name).toBe('spawn_planner');
    expect(parsed.frontmatter.completion_event).toBe('requirements_completed');
    expect(parsed.body.trim()).toBe('Body here.');
  });

  it('parses a valid event file with empty signal_payload', () => {
    const text = [
      '---',
      'kind: event',
      'name: requirements_completed',
      'title: Requirements completed',
      'description: Fires after requirements doc lands.',
      'signal_payload: {}',
      '---',
      'Signal this when the requirements doc is saved.',
      '',
    ].join('\n');
    const parsed = parseActionEventFile(text, 'event.requirements_completed.md');
    expect(parsed.kind).toBe('event');
    expect(parsed.frontmatter.signal_payload).toEqual({});
  });

  it('errors when frontmatter.name disagrees with filename stem', () => {
    const text = [
      '---',
      'kind: action',
      'name: wrong_name',
      'title: x',
      'description: x',
      'category: gate',
      'completion_event: null',
      '---',
      '',
    ].join('\n');
    expect(() => parseActionEventFile(text, 'action.spawn_planner.md'))
      .toThrow(/action\.spawn_planner\.md/);
  });

  it('errors when category is outside the allowed set', () => {
    const text = [
      '---',
      'kind: action',
      'name: x',
      'title: x',
      'description: x',
      'category: bogus',
      'completion_event: null',
      '---',
      '',
    ].join('\n');
    expect(() => parseActionEventFile(text, 'action.x.md'))
      .toThrow(/category/);
  });

  it('parses a fully-populated multi-outcome action and round-trips alternate_outcomes', () => {
    const text = actionText([
      'completion_when: The operator approves the task.',
      'alternate_outcomes:',
      '  - event: gate_rejected',
      '    when: The operator rejects the task.',
      '    values:',
      '      gate-type: task',
    ]);
    const parsed = parseActionEventFile(text, 'action.gate_task.md');
    const fm = parsed.frontmatter as ActionFrontmatter;
    expect(fm.completion_when).toBe('The operator approves the task.');
    expect(fm.alternate_outcomes).toEqual([
      { event: 'gate_rejected', when: 'The operator rejects the task.', values: { 'gate-type': 'task' } },
    ]);
  });

  it('errors when alternate_outcomes is non-empty but completion_when is absent', () => {
    const text = actionText([
      'alternate_outcomes:',
      '  - event: gate_rejected',
      '    when: The operator rejects the task.',
    ]);
    expect(() => parseActionEventFile(text, 'action.gate_task.md'))
      .toThrow(/completion_when/);
  });

  it('errors when completion_when is present but alternate_outcomes is absent', () => {
    const text = actionText(['completion_when: The operator approves the task.']);
    expect(() => parseActionEventFile(text, 'action.gate_task.md'))
      .toThrow(/completion_when/);
  });

  it('errors when completion_when is an empty string', () => {
    const text = actionText([
      'completion_when: ""',
      'alternate_outcomes:',
      '  - event: gate_rejected',
      '    when: The operator rejects the task.',
    ]);
    expect(() => parseActionEventFile(text, 'action.gate_task.md'))
      .toThrow(/completion_when/);
  });

  it('errors when alternate_outcomes is not an array', () => {
    const text = actionText([
      'completion_when: The operator approves the task.',
      'alternate_outcomes: gate_rejected',
    ]);
    expect(() => parseActionEventFile(text, 'action.gate_task.md'))
      .toThrow(/alternate_outcomes/);
  });

  it('errors when an alternate_outcomes entry is missing event', () => {
    const text = actionText([
      'completion_when: The operator approves the task.',
      'alternate_outcomes:',
      '  - when: The operator rejects the task.',
    ]);
    expect(() => parseActionEventFile(text, 'action.gate_task.md'))
      .toThrow(/alternate_outcomes\[0\]\.event/);
  });

  it('errors when an alternate_outcomes entry is missing when', () => {
    const text = actionText([
      'completion_when: The operator approves the task.',
      'alternate_outcomes:',
      '  - event: gate_rejected',
    ]);
    expect(() => parseActionEventFile(text, 'action.gate_task.md'))
      .toThrow(/alternate_outcomes\[0\]\.when/);
  });

  it('errors when an alternate_outcomes entry has a non-string value in values', () => {
    const text = actionText([
      'completion_when: The operator approves the task.',
      'alternate_outcomes:',
      '  - event: gate_rejected',
      '    when: The operator rejects the task.',
      '    values:',
      '      gate-type: 1',
    ]);
    expect(() => parseActionEventFile(text, 'action.gate_task.md'))
      .toThrow(/alternate_outcomes\[0\]\.values/);
  });

  it('errors when completion_signalled_by is outside orchestrator|skill', () => {
    const text = actionText(['completion_signalled_by: bogus']);
    expect(() => parseActionEventFile(text, 'action.gate_task.md'))
      .toThrow(/completion_signalled_by/);
  });

  it('errors when completion_signalled_by is skill combined with completion_when and alternate_outcomes', () => {
    const text = actionText([
      'completion_signalled_by: skill',
      'completion_when: The operator approves the task.',
      'alternate_outcomes:',
      '  - event: gate_rejected',
      '    when: The operator rejects the task.',
    ]);
    expect(() => parseActionEventFile(text, 'action.gate_task.md'))
      .toThrow(/completion_signalled_by/);
  });

  it('parses completion_signalled_by: skill with no completion_when or alternate_outcomes', () => {
    const text = actionText(['completion_signalled_by: skill']);
    const parsed = parseActionEventFile(text, 'action.gate_task.md');
    const fm = parsed.frontmatter as ActionFrontmatter;
    expect(fm.completion_signalled_by).toBe('skill');
  });

  it('errors when any of the four new fields are set on a terminal action (completion_event: null)', () => {
    const text = [
      '---',
      'kind: action',
      'name: display_complete',
      'title: Display complete',
      'description: Display completion.',
      'category: terminal',
      'completion_event: null',
      'completion_when: This should not be allowed.',
      '---',
      '',
    ].join('\n');
    expect(() => parseActionEventFile(text, 'action.display_complete.md'))
      .toThrow(/completion_when/);
  });

  it('accepts a signal_payload flag with array: true and no item_keys (pre-existing catalogs predate the field)', () => {
    const text = [
      '---',
      'kind: event',
      'name: task_completed',
      'title: Task completed',
      'description: The task has completed.',
      'signal_payload:',
      '  repos:',
      '    required: false',
      '    array: true',
      '    description: Per-repo result array.',
      '---',
      '',
    ].join('\n');
    const parsed = parseActionEventFile(text, 'event.task_completed.md');
    const payload = (parsed.frontmatter as { signal_payload: Record<string, { item_keys?: string[] }> }).signal_payload;
    expect(payload['repos']?.item_keys).toBeUndefined();
  });

  it('accepts a signal_payload flag with json: true', () => {
    const text = [
      '---',
      'kind: event',
      'name: explosion_failed',
      'title: Explosion failed',
      'description: The plan could not be parsed.',
      'signal_payload:',
      '  parse-error:',
      '    required: true',
      '    json: true',
      '    description: JSON-encoded parse failure.',
      '---',
      '',
    ].join('\n');
    const parsed = parseActionEventFile(text, 'event.explosion_failed.md');
    const payload = (parsed.frontmatter as { signal_payload: Record<string, { json?: boolean }> }).signal_payload;
    expect(payload['parse-error']?.json).toBe(true);
  });

  it('errors when json is present but not a boolean', () => {
    const text = [
      '---',
      'kind: event',
      'name: explosion_failed',
      'title: Explosion failed',
      'description: The plan could not be parsed.',
      'signal_payload:',
      '  parse-error:',
      '    required: true',
      '    json: yes please',
      '    description: JSON-encoded parse failure.',
      '---',
      '',
    ].join('\n');
    expect(() => parseActionEventFile(text, 'event.explosion_failed.md'))
      .toThrow(/json must be a boolean/);
  });

  it('errors when a flag sets both array and json', () => {
    const text = [
      '---',
      'kind: event',
      'name: task_completed',
      'title: Task completed',
      'description: The task has completed.',
      'signal_payload:',
      '  repos:',
      '    required: false',
      '    array: true',
      '    json: true',
      '    item_keys: [name]',
      '    description: Per-repo result array.',
      '---',
      '',
    ].join('\n');
    expect(() => parseActionEventFile(text, 'event.task_completed.md'))
      .toThrow(/cannot set both array and json/);
  });

  it('errors when a signal_payload flag has array: true and item_keys is present but malformed', () => {
    const text = [
      '---',
      'kind: event',
      'name: task_completed',
      'title: Task completed',
      'description: The task has completed.',
      'signal_payload:',
      '  repos:',
      '    required: false',
      '    array: true',
      '    item_keys: [name, ""]',
      '    description: Per-repo result array.',
      '---',
      '',
    ].join('\n');
    expect(() => parseActionEventFile(text, 'event.task_completed.md'))
      .toThrow(/item_keys/);
  });

  it('errors when a signal_payload flag declares item_keys but is not an array flag', () => {
    const text = [
      '---',
      'kind: event',
      'name: gate_mode_set',
      'title: Gate mode set',
      'description: The gate mode has been set.',
      'signal_payload:',
      '  gate-mode:',
      '    required: true',
      '    item_keys: [name]',
      '    description: The chosen gate mode.',
      '---',
      '',
    ].join('\n');
    expect(() => parseActionEventFile(text, 'event.gate_mode_set.md'))
      .toThrow(/item_keys/);
  });

  it('parses every real catalog file under runtime-config/action-events/ without throwing', () => {
    const files = fs.readdirSync(CATALOG_ROOT)
      .filter((f) => /^(action|event)\.[a-z0-9_]+\.md$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const filename of files) {
      const text = fs.readFileSync(path.join(CATALOG_ROOT, filename), 'utf8');
      expect(() => parseActionEventFile(text, filename)).not.toThrow();
    }
  });
});

// Parsing each file in isolation cannot see the cross-file relationships the
// composer validates — a declared event with no payload, or an outcome value
// naming a flag that event never declares. Left to the composer alone, a catalog
// authoring error surfaces as a thrown error mid-run, on whichever tick first
// reaches the action. These pin it at CI time instead.
describe('the real catalog composes', () => {
  function loadCatalog() {
    const payloads: Record<string, EventFrontmatter['signal_payload']> = {};
    const actions: ActionFrontmatter[] = [];
    for (const filename of fs.readdirSync(CATALOG_ROOT).filter((f) => /^(action|event)\.[a-z0-9_]+\.md$/.test(f))) {
      const parsed = parseActionEventFile(fs.readFileSync(path.join(CATALOG_ROOT, filename), 'utf8'), filename);
      if (parsed.kind === 'event') payloads[parsed.name] = (parsed.frontmatter as EventFrontmatter).signal_payload ?? {};
      else actions.push(parsed.frontmatter as ActionFrontmatter);
    }
    return { payloads, actions };
  }

  const compose = (action: ActionFrontmatter, payloads: Record<string, EventFrontmatter['signal_payload']>) =>
    buildCompletionCommands({
      action,
      payloads,
      scriptPath: '/opt/radorch/radorch.mjs',
      projectDir: '/home/dev/.radorc/projects/DEMO',
      known: {},
      repoNames: ['rad-orc-source'],
    });

  it('composes every action without a validation error', () => {
    const { payloads, actions } = loadCatalog();
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(() => compose(action, payloads), `action '${action.name}'`).not.toThrow();
    }
  });

  // Without this, deleting `json: true` from event.explosion_failed.md leaves the
  // whole suite green while silently re-breaking every explosion_failed signal:
  // the shell eats the JSON's own double quotes and JSON.parse rejects it.
  it('renders the parse-error marker single-quoted so substituted JSON survives the shell', () => {
    const { payloads, actions } = loadCatalog();
    const explode = actions.find((a) => a.name === 'explode_master_plan');
    expect(explode).toBeDefined();
    const failed = compose(explode!, payloads).find((c) => c.event === 'explosion_failed');
    expect(failed?.command).toContain(`--parse-error '<fill-in: parse-error>'`);
  });
});
