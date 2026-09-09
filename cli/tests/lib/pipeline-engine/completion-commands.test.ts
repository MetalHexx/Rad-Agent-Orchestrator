import { describe, expect, it } from 'vitest';
import {
  buildCompletionCommands,
  buildSignalGuidance,
} from '../../../src/lib/pipeline-engine/completion-commands.js';
import type { CompletionCommandsInput } from '../../../src/lib/pipeline-engine/completion-commands.js';
import type { ActionFrontmatter, EventFrontmatter } from '../../../src/lib/pipeline-engine/action-event-loader.js';

type SignalPayload = EventFrontmatter['signal_payload'];

const SCRIPT_PATH = '/opt/radorch/radorch.mjs';
const PROJECT_DIR = '/home/dev/.radorc/projects/DEMO';
const PREFIX = `node "${SCRIPT_PATH}" pipeline signal`;

function action(fm: Partial<ActionFrontmatter>): ActionFrontmatter {
  return {
    kind: 'action',
    name: 'execute_task',
    title: 't',
    description: 'd',
    category: 'agent-spawn',
    completion_event: 'task_completed',
    ...fm,
  };
}

function build(
  fm: Partial<ActionFrontmatter>,
  payloads: Record<string, SignalPayload>,
  overrides: Partial<CompletionCommandsInput> = {},
) {
  return buildCompletionCommands({
    action: action(fm),
    payloads,
    scriptPath: SCRIPT_PATH,
    projectDir: PROJECT_DIR,
    known: {},
    repoNames: [],
    ...overrides,
  });
}

describe('buildCompletionCommands — when no command exists', () => {
  it('returns an empty array for a terminal action', () => {
    expect(build({ name: 'display_complete', completion_event: null }, {})).toEqual([]);
  });

  it('returns an empty array when another skill signals the completion event', () => {
    const commands = build(
      { name: 'request_plan_approval', completion_event: 'plan_approved', completion_signalled_by: 'skill' },
      { plan_approved: {} },
    );
    expect(commands).toEqual([]);
  });
});

describe('buildCompletionCommands — the command line', () => {
  it('prefixes with bare node, the quoted script path, and the quoted project dir', () => {
    const commands = build({}, { task_completed: {} });
    expect(commands).toEqual([
      {
        event: 'task_completed',
        command: `${PREFIX} --event task_completed --project-dir "${PROJECT_DIR}"`,
      },
    ]);
  });

  it('renders flags in signal_payload declaration order', () => {
    const commands = build({}, {
      task_completed: {
        phase: { required: false, description: 'phase' },
        task: { required: false, description: 'task' },
        branch: { required: false, description: 'branch' },
        repos: { required: false, array: true, item_keys: ['name', 'commitHash'], description: 'repos' },
      },
    }, { known: { phase: '1', task: '2' }, repoNames: ['rad-orc-source'] });
    const flags = [...commands[0].command.matchAll(/--([a-z-]+)/g)].map(m => m[1]);
    expect(flags).toEqual(['event', 'project-dir', 'phase', 'task', 'branch', 'repos']);
  });

  it('fills a known all-digit value bare and a known non-digit value double-quoted', () => {
    const commands = build({}, {
      task_completed: {
        phase: { required: false, description: 'phase' },
        branch: { required: false, description: 'branch' },
      },
    }, { known: { phase: '1', branch: 'feature/my branch' } });
    expect(commands[0].command).toContain('--phase 1');
    expect(commands[0].command).toContain('--branch "feature/my branch"');
  });

  it('renders an unknown scalar as a double-quoted marker', () => {
    const commands = build({}, {
      task_completed: { branch: { required: false, description: 'branch' } },
    });
    expect(commands[0].command).toContain('--branch "<fill-in: branch>"');
  });

  it('renders an optional flag that is neither known nor an outcome value as a marker', () => {
    const commands = build({}, {
      task_completed: { verdict: { required: false, description: 'verdict' } },
    });
    expect(commands[0].command).toContain('--verdict "<fill-in: verdict>"');
  });

  // A JSON value carries its own double quotes. Double-quoting its marker has the
  // shell consume them, so what reaches JSON.parse is no longer JSON; single quotes
  // are literal in bash and PowerShell 7+ and let the substitution survive. (Not on
  // Windows PowerShell 5.1 — see renderArraySkeleton for the exception `--repos`
  // has always shared.)
  it('renders a json-valued marker single-quoted', () => {
    const commands = build({ name: 'explode_master_plan', completion_event: 'explosion_failed' }, {
      explosion_failed: { 'parse-error': { required: true, json: true, description: 'the parse failure' } },
    });
    expect(commands[0].command).toContain(`--parse-error '<fill-in: parse-error>'`);
    expect(commands[0].command).not.toContain(`"<fill-in: parse-error>"`);
  });

  it('keeps double quotes on a scalar marker that is not json-valued', () => {
    const commands = build({}, {
      task_completed: {
        branch: { required: false, description: 'branch' },
        'parse-error': { required: false, json: false, description: 'not json after all' },
      },
    });
    expect(commands[0].command).toContain('--branch "<fill-in: branch>"');
    expect(commands[0].command).toContain(`--parse-error "<fill-in: parse-error>"`);
  });
});

describe('buildCompletionCommands — array flags', () => {
  const arrayPayload: Record<string, SignalPayload> = {
    task_completed: {
      repos: {
        required: false,
        array: true,
        item_keys: ['name', 'committed', 'commitHash', 'pushed'],
        description: 'per-repo commit results',
      },
    },
  };

  it('pre-fills every name and leaves the other keys as bare markers', () => {
    const commands = build({}, arrayPayload, { repoNames: ['rad-orc-source', 'rad-orc-ui'] });
    expect(commands[0].command).toContain(
      `--repos '[{"name":"rad-orc-source","committed":<fill-in: committed>,"commitHash":<fill-in: commitHash>,"pushed":<fill-in: pushed>},`
      + `{"name":"rad-orc-ui","committed":<fill-in: committed>,"commitHash":<fill-in: commitHash>,"pushed":<fill-in: pushed>}]'`,
    );
  });

  it('renders a whole-flag marker rather than an empty array when no repo names are known', () => {
    const commands = build({}, arrayPayload, { repoNames: [] });
    expect(commands[0].command).toContain(`--repos '<fill-in: repos>'`);
    expect(commands[0].command).not.toContain(`'[]'`);
  });
});

describe('buildCompletionCommands — contextually inapplicable flags', () => {
  const taskPayload: Record<string, SignalPayload> = {
    task_completed: {
      phase: { required: false, description: 'phase number' },
      task: { required: false, description: 'task number' },
      branch: { required: false, description: 'branch' },
      repos: { required: false, array: true, item_keys: ['name', 'committed'], description: 'repos' },
    },
  };

  it('drops an omitted scalar entirely rather than marking it', () => {
    const commands = build({}, taskPayload, { known: { phase: '2' }, omit: ['task'] });
    expect(commands[0].command).toContain('--phase 2');
    expect(commands[0].command).not.toContain('--task');
    expect(commands[0].command).not.toContain('<fill-in: task>');
  });

  it('drops an omitted array flag entirely rather than rendering a skeleton', () => {
    const commands = build({}, taskPayload, { repoNames: ['rad-orc-source'], omit: ['branch', 'repos'] });
    expect(commands[0].command).not.toContain('--repos');
    expect(commands[0].command).not.toContain('--branch');
    expect(commands[0].command).not.toContain('rad-orc-source');
  });

  it('still marks an optional flag that was not omitted', () => {
    // The naive fix — drop every unknown optional flag — would empty this
    // command out. Only the listed flags go.
    const commands = build({}, taskPayload, { known: { phase: '2' }, repoNames: ['r'], omit: ['task'] });
    expect(commands[0].command).toContain('--branch "<fill-in: branch>"');
    expect(commands[0].command).toContain('--repos \'[{"name":"r"');
  });

  it('keeps a required flag the caller asked to omit', () => {
    // `repos` is optional on task_completed and required on pr_created; the
    // caller decides omission from context and cannot tell the two apart, so a
    // required declaration vetoes it rather than yielding an unparseable command.
    const commands = build({ completion_event: 'pr_created' }, {
      pr_created: { repos: { required: true, array: true, item_keys: ['name', 'pr_url'], description: 'prs' } },
    }, { repoNames: ['rad-orc-source'], omit: ['repos'] });
    expect(commands[0].command).toContain('--repos \'[{"name":"rad-orc-source"');
  });

  it('keeps a flag that carries an outcome-identifying value', () => {
    // Dropping it would render both outcomes as the same command, leaving the
    // `when` text the only thing distinguishing them.
    const commands = build({
      name: 'gate_task',
      completion_event: 'task_gate_approved',
      completion_when: 'approved',
      alternate_outcomes: [{ event: 'gate_rejected', when: 'rejected', values: { task: '7' } }],
    }, {
      task_gate_approved: {},
      gate_rejected: { task: { required: false, description: 'task number' } },
    }, { omit: ['task'] });
    expect(commands[1].command).toContain('--task 7');
  });

  it('changes nothing when the omit list is empty or absent', () => {
    const withEmpty = build({}, taskPayload, { known: { phase: '1' }, repoNames: ['r'], omit: [] });
    const withNone = build({}, taskPayload, { known: { phase: '1' }, repoNames: ['r'] });
    expect(withEmpty[0].command).toEqual(withNone[0].command);
    expect(withNone[0].command).toContain('--task "<fill-in: task>"');
  });
});

describe('buildCompletionCommands — multiple outcomes', () => {
  const gateTask = {
    name: 'gate_task',
    category: 'gate' as const,
    completion_event: 'task_gate_approved',
    completion_when: 'The operator approves the task.',
    alternate_outcomes: [
      { event: 'gate_rejected', when: 'The operator rejects the task.', values: { 'gate-type': 'task' } },
    ],
  };
  const gatePayloads: Record<string, SignalPayload> = {
    task_gate_approved: {},
    gate_rejected: {
      'gate-type': { required: true, description: 'which gate' },
      reason: { required: true, description: 'why' },
    },
  };

  it('carries when on every entry when there is more than one', () => {
    const commands = build(gateTask, gatePayloads);
    expect(commands.map(c => c.event)).toEqual(['task_gate_approved', 'gate_rejected']);
    expect(commands.every(c => typeof c.when === 'string' && c.when.length > 0)).toBe(true);
  });

  it('omits when entirely when there is exactly one entry', () => {
    const commands = build({}, { task_completed: {} });
    expect(commands).toHaveLength(1);
    expect('when' in commands[0]).toBe(false);
  });

  it('fills an outcome-identifying value on its own entry only', () => {
    const commands = build(gateTask, gatePayloads);
    const [approved, rejected] = commands;
    expect(rejected.command).toContain('--gate-type task');
    expect(rejected.command).toContain('--reason "<fill-in: reason>"');
    expect(approved.command).not.toContain('--gate-type');
    expect(approved.command).not.toContain('--reason');
  });
});

describe('buildCompletionCommands — catalog gaps', () => {
  it('throws naming the action and the event when a declared event has no payload', () => {
    expect(() => build(
      {
        name: 'gate_phase',
        completion_event: 'phase_gate_approved',
        completion_when: 'approved',
        alternate_outcomes: [{ event: 'gate_rejected', when: 'rejected' }],
      },
      { phase_gate_approved: {} },
    )).toThrow(/gate_phase[\s\S]*gate_rejected/);
  });

  // renderCommand looks outcome values up by flag name and ignores what it does not
  // recognise, so an unvalidated typo would leave the real flag standing as a marker
  // and collapse the outcome it was meant to distinguish.
  it('throws naming the offending key and the valid flags when an outcome value names no declared flag', () => {
    expect(() => build(
      {
        name: 'gate_task',
        completion_event: 'task_gate_approved',
        completion_when: 'approved',
        alternate_outcomes: [{ event: 'gate_rejected', when: 'rejected', values: { gate_type: 'task' } }],
      },
      {
        task_gate_approved: {},
        gate_rejected: {
          'gate-type': { required: true, description: 'which gate' },
          reason: { required: true, description: 'why' },
        },
      },
    )).toThrow(/gate_task[\s\S]*gate_type[\s\S]*gate_rejected[\s\S]*gate-type, reason/);
  });

  it('throws when an outcome value names an array flag, whose skeleton never consults it', () => {
    expect(() => build(
      {
        name: 'invoke_source_control_pr',
        completion_event: 'pr_created',
        completion_when: 'created',
        alternate_outcomes: [{ event: 'pr_created', when: 'again', values: { repos: '[]' } }],
      },
      {
        pr_created: {
          repos: { required: true, array: true, item_keys: ['name', 'pr_url'], description: 'pr results' },
        },
      },
    )).toThrow(/array flag/);
  });

  // `toString` resolves through Object.prototype, so a plain `=== undefined`
  // check would wave it past while it still names no declared flag.
  it('throws on an outcome value keyed by an inherited Object property', () => {
    expect(() => build(
      {
        name: 'gate_task',
        completion_event: 'task_gate_approved',
        completion_when: 'approved',
        alternate_outcomes: [{ event: 'gate_rejected', when: 'rejected', values: { toString: 'task' } }],
      },
      { task_gate_approved: {}, gate_rejected: { 'gate-type': { required: true, description: 'which gate' } } },
    )).toThrow(/declares no such flag/);
  });

  // Outcome values render verbatim, with none of renderKnownValue's quoting, so
  // a space-bearing value would be parsed as excess arguments and rejected.
  it('throws on an outcome value that would not survive the shell unquoted', () => {
    expect(() => build(
      {
        name: 'gate_task',
        completion_event: 'task_gate_approved',
        completion_when: 'approved',
        alternate_outcomes: [{ event: 'gate_rejected', when: 'rejected', values: { 'gate-type': 'task gate' } }],
      },
      { task_gate_approved: {}, gate_rejected: { 'gate-type': { required: true, description: 'which gate' } } },
    )).toThrow(/not a bare token/);
  });

  it('accepts an outcome value that names a declared scalar flag', () => {
    expect(() => build(
      {
        name: 'gate_task',
        completion_event: 'task_gate_approved',
        completion_when: 'approved',
        alternate_outcomes: [{ event: 'gate_rejected', when: 'rejected', values: { 'gate-type': 'task' } }],
      },
      {
        task_gate_approved: {},
        gate_rejected: { 'gate-type': { required: true, description: 'which gate' } },
      },
    )).not.toThrow();
  });
});

describe('buildSignalGuidance', () => {
  const payloads: Record<string, SignalPayload> = {
    task_completed: {
      phase: { required: false, description: 'phase number' },
      branch: { required: false, description: 'the branch the coder committed on' },
      repos: {
        required: false,
        array: true,
        item_keys: ['name', 'committed'],
        description: 'per-repo commit results',
      },
    },
  };

  it('names completion_commands and never refers to it by position', () => {
    const commands = build({}, payloads, { known: { phase: '1' }, repoNames: ['rad-orc-source'] });
    const guidance = buildSignalGuidance(commands, payloads, { phase: '1' });
    expect(guidance).toContain('`completion_commands`');
    expect(guidance).not.toMatch(/\b(below|above|the following)\b/i);
  });

  it('lists exactly the flags left as markers and no others', () => {
    const known = { phase: '1' };
    const commands = build({}, payloads, { known, repoNames: ['rad-orc-source'] });
    const guidance = buildSignalGuidance(commands, payloads, known);
    const listed = [...guidance.matchAll(/^- `--([a-z-]+)`/gm)].map(m => m[1]);
    expect(listed).toEqual(['branch', 'repos']);
  });

  it('states that pre-filled repo names must not be changed', () => {
    const commands = build({}, payloads, { repoNames: ['rad-orc-source'] });
    const guidance = buildSignalGuidance(commands, payloads, {});
    const reposLine = guidance.split('\n').find(l => l.startsWith('- `--repos`'))!;
    expect(reposLine).toMatch(/`name`/);
  });

  it('carries the row shape when the array flag is a whole-flag marker', () => {
    const commands = build({}, payloads, { repoNames: [] });
    const guidance = buildSignalGuidance(commands, payloads, {});
    const reposLine = guidance.split('\n').find(l => l.startsWith('- `--repos`'))!;
    expect(reposLine).toContain('`name`');
    expect(reposLine).toContain('`committed`');
  });

  it('lists nothing when every flag is already filled', () => {
    const noMarkerPayloads: Record<string, SignalPayload> = {
      task_completed: { phase: { required: false, description: 'phase number' } },
    };
    const known = { phase: '3' };
    const commands = build({}, noMarkerPayloads, { known });
    const guidance = buildSignalGuidance(commands, noMarkerPayloads, known);
    expect(guidance).not.toMatch(/^- `--/m);
  });

  it('says nothing about an omitted scalar', () => {
    const known = { phase: '1' };
    const commands = build({}, payloads, { known, omit: ['branch'], repoNames: ['rad-orc-source'] });
    const guidance = buildSignalGuidance(commands, payloads, known);
    expect(guidance).not.toContain('--branch');
    const listed = [...guidance.matchAll(/^- `--([a-z-]+)`/gm)].map(m => m[1]);
    expect(listed).toEqual(['repos']);
  });

  it('says nothing about an omitted array flag', () => {
    // The array branch used to emit its note unconditionally, so an omitted
    // `--repos` still drew "every `name` is already correct" for a flag the
    // command does not carry.
    const known = { phase: '1' };
    const commands = build({}, payloads, { known, omit: ['repos'], repoNames: ['rad-orc-source'] });
    const guidance = buildSignalGuidance(commands, payloads, known);
    expect(guidance).not.toContain('--repos');
    expect(guidance).not.toContain('`name`');
    const listed = [...guidance.matchAll(/^- `--([a-z-]+)`/gm)].map(m => m[1]);
    expect(listed).toEqual(['branch']);
  });

  it('notes an array flag the omission did not actually drop', () => {
    // The renderer keeps a required flag even when the caller listed it for
    // omission — the real `pr_created` case, where dropping `--repos` parses fine
    // and silently records zero pr_urls. Reading presence back off the command is
    // what keeps the guidance from silently disagreeing about that.
    const arrayPayloads: Record<string, SignalPayload> = {
      pr_created: {
        repos: { required: true, array: true, item_keys: ['name', 'pr_url'], description: 'per-repo PR results' },
      },
    };
    const commands = build(
      { name: 'invoke_source_control_pr', completion_event: 'pr_created' },
      arrayPayloads,
      { omit: ['repos'], repoNames: ['rad-orc-source'] },
    );
    expect(commands[0].command).toContain('--repos');
    expect(buildSignalGuidance(commands, arrayPayloads, {})).toMatch(/^- `--repos`/m);
  });

  it('tells the orchestrator to choose by when only when there is more than one entry', () => {
    const single = buildSignalGuidance(build({}, { task_completed: {} }), { task_completed: {} }, {});
    expect(single).not.toContain('`when`');

    const multiAction = {
      name: 'gate_task',
      completion_event: 'task_gate_approved',
      completion_when: 'approved',
      alternate_outcomes: [{ event: 'gate_rejected', when: 'rejected' }],
    };
    const multiPayloads: Record<string, SignalPayload> = { task_gate_approved: {}, gate_rejected: {} };
    const multi = buildSignalGuidance(build(multiAction, multiPayloads), multiPayloads, {});
    expect(multi).toContain('`when`');
  });
});
