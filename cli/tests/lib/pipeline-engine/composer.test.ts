import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeActionPrompt, composeOrphanEventPrompt, deriveSignalLine } from '../../../src/lib/pipeline-engine/composer.js';
import type { EventFrontmatter } from '../../../src/lib/pipeline-engine/action-event-loader.js';

function makeCatalog(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-'));
  fs.mkdirSync(path.join(dir, 'custom'), { recursive: true });
  return dir;
}

describe('composeActionPrompt — customs', () => {
  it('emits all three slot headings when matching customs exist', () => {
    const dir = makeCatalog();
    fs.writeFileSync(path.join(dir, 'action.spawn_planner.md'), [
      '---', 'kind: action', 'name: spawn_planner', 'title: t', 'description: d',
      'category: agent-spawn', 'completion_event: requirements_completed', '---',
      'Main body.', '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'event.requirements_completed.md'), [
      '---', 'kind: event', 'name: requirements_completed', 'title: t', 'description: d',
      'signal_payload: {}', '---',
      'Event body.', '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'custom', 'action.spawn_planner.pre.md'), 'Pre-action custom.');
    fs.writeFileSync(path.join(dir, 'custom', 'event.requirements_completed.pre.md'), 'Pre-signal custom.');
    fs.writeFileSync(path.join(dir, 'custom', 'event.requirements_completed.post.md'), 'Post-signal custom.');

    const out = composeActionPrompt({
      actionName: 'spawn_planner', completionEvent: 'requirements_completed', catalogRoot: dir,
    });
    // With Step-N numbering: Step 1 = pre-action, Step 2 = body, Step 3 = pre-event, Step 4 = when-complete, Step 5 = post-event.
    expect(out.prompt.indexOf('Pre-action custom.')).toBeLessThan(out.prompt.indexOf('Main body.'));
    expect(out.prompt.indexOf('Main body.')).toBeLessThan(out.prompt.indexOf('Pre-signal custom.'));
    expect(out.prompt.indexOf('Pre-signal custom.')).toBeLessThan(out.prompt.indexOf('Event body.'));
    expect(out.prompt.indexOf('Event body.')).toBeLessThan(out.prompt.indexOf('Post-signal custom.'));
  });

  it('throws when the envelope consumes an action whose custom pre exists but catalog is missing', () => {
    const dir = makeCatalog();
    // No action.ghost_action.md created — catalog is intentionally missing.
    fs.writeFileSync(path.join(dir, 'custom', 'action.ghost_action.pre.md'), 'pre body');

    expect(() => composeActionPrompt({
      actionName: 'ghost_action',
      completionEvent: null,
      catalogRoot: dir,
    })).toThrow(/action\.ghost_action\.md/);
  });

  it('does not throw when an unrelated custom for an unknown event is outside the current envelope (AD-7)', () => {
    const dir = makeCatalog();
    fs.writeFileSync(path.join(dir, 'action.real_action.md'), [
      '---', 'kind: action', 'name: real_action', 'title: t', 'description: d',
      'category: gate', 'completion_event: null', '---', 'body', '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'custom', 'action.real_action.pre.md'), 'ok');
    // An UNRELATED custom for an unknown event — not consumed by this envelope, so does not fail.
    fs.writeFileSync(path.join(dir, 'custom', 'event.never_referenced.post.md'), 'ignored');

    // Composing action.real_action with no event should succeed (AD-7).
    expect(() => composeActionPrompt({
      actionName: 'real_action', completionEvent: null, catalogRoot: dir,
    })).not.toThrow();
  });

  it('errors when an event custom targets an unknown event name', () => {
    const dir = makeCatalog();
    fs.writeFileSync(path.join(dir, 'action.with_event.md'), [
      '---', 'kind: action', 'name: with_event', 'title: t', 'description: d',
      'category: agent-spawn', 'completion_event: bogus_event', '---', 'body', '',
    ].join('\n'));
    // Custom referencing bogus_event exists and IS consumed by the envelope.
    fs.writeFileSync(path.join(dir, 'custom', 'event.bogus_event.pre.md'), 'oops');

    expect(() => composeActionPrompt({
      actionName: 'with_event', completionEvent: 'bogus_event', catalogRoot: dir,
    })).toThrow(/event\.bogus_event\.md/);
  });
});

describe('composeActionPrompt — bare (no customs)', () => {
  it('composes action body + When complete heading + signal line with flags', () => {
    const dir = makeCatalog();
    fs.writeFileSync(path.join(dir, 'action.spawn_planner.md'), [
      '---',
      'kind: action', 'name: spawn_planner', 'title: t', 'description: d',
      'category: agent-spawn', 'completion_event: requirements_completed',
      '---',
      'Spawn the planner agent now.',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'event.requirements_completed.md'), [
      '---',
      'kind: event', 'name: requirements_completed', 'title: t', 'description: d',
      'signal_payload:',
      '  doc-path:',
      '    required: true',
      '    description: path to the requirements doc',
      '---',
      'Signal this after the requirements doc lands on disk.',
      '',
    ].join('\n'));

    const out = composeActionPrompt({
      actionName: 'spawn_planner',
      completionEvent: 'requirements_completed',
      catalogRoot: dir,
    });

    expect(out.prompt.startsWith('## Step 1\n\nSpawn the planner agent now.')).toBe(true);
    expect(out.prompt).toContain('Signal this after the requirements doc lands on disk.');
    expect(out.prompt.trim().endsWith('Signal: requirements_completed --doc-path <value>')).toBe(true);
    expect(out.prompt).not.toContain('## Before doing this action');
    expect(out.prompt).not.toContain('## Before signaling');
    expect(out.prompt).not.toContain('## After signaling');
  });

  it('emits Signal: <event-name> with no flags when signal_payload is empty', () => {
    const dir = makeCatalog();
    fs.writeFileSync(path.join(dir, 'action.gate_open.md'), [
      '---',
      'kind: action', 'name: gate_open', 'title: t', 'description: d',
      'category: gate', 'completion_event: gate_approved',
      '---',
      'Open the gate.',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'event.gate_approved.md'), [
      '---',
      'kind: event', 'name: gate_approved', 'title: t', 'description: d',
      'signal_payload: {}',
      '---',
      'Signal after approval.',
      '',
    ].join('\n'));

    const out = composeActionPrompt({
      actionName: 'gate_open',
      completionEvent: 'gate_approved',
      catalogRoot: dir,
    });
    expect(out.prompt).toMatch(/Signal: gate_approved\s*$/);
  });

  it('omits When complete and After signaling for terminal actions', () => {
    const dir = makeCatalog();
    fs.writeFileSync(path.join(dir, 'action.display_complete.md'), [
      '---',
      'kind: action', 'name: display_complete', 'title: t', 'description: d',
      'category: terminal', 'completion_event: null',
      '---',
      'Display the completion screen.',
      '',
    ].join('\n'));

    const out = composeActionPrompt({
      actionName: 'display_complete',
      completionEvent: null,
      catalogRoot: dir,
    });
    expect(out.prompt).not.toContain('## When complete');
    expect(out.prompt).not.toContain('## After signaling');
    expect(out.prompt).not.toContain('Signal:');
  });
});

function seedCatalog(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-step-'));
  fs.mkdirSync(path.join(root, 'custom'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'action.foo.md'),
    '---\nkind: action\nname: foo\ntitle: Foo\ndescription: Foo action.\ncategory: agent-spawn\ncompletion_event: bar_done\n---\n\nfoo body.\n',
  );
  fs.writeFileSync(
    path.join(root, 'event.bar_done.md'),
    '---\nkind: event\nname: bar_done\ntitle: Bar Done\ndescription: Bar done event.\nsignal_payload: {}\n---\n\nbar done body.\n',
  );
  fs.writeFileSync(
    path.join(root, 'event.kickoff.md'),
    '---\nkind: event\nname: kickoff\ntitle: Kickoff\ndescription: Kickoff event.\nsignal_payload: {}\n---\n\nkickoff body.\n',
  );
  return root;
}

describe('composeActionPrompt — Step-N numbering and has_custom_instructions', () => {
  it('numbers every admitted section as ## Step N starting at 1, including the shipped action body', () => {
    const root = seedCatalog(); // helper from existing suite
    const result = composeActionPrompt({
      actionName: 'foo',
      completionEvent: 'bar_done',
      catalogRoot: root,
      overlay: {
        'action.foo.pre':       'pre-action custom',
        'event.bar_done.pre':   'pre-event custom',
        'event.bar_done.post':  'post-event custom',
      },
    });
    expect(result.prompt).toMatch(/^## Step 1\n\npre-action custom\n\n## Step 2\n\nfoo body\./);
    expect(result.prompt).toMatch(/## Step 3\n\npre-event custom\n\n## Step 4\n\n/);
    expect(result.prompt).toMatch(/## Step 5\n\npost-event custom\s*$/);
    expect(result.has_custom_instructions).toBe(true);
  });

  it('collapses empty overlay slots — next admitted section receives the next number', () => {
    const root = seedCatalog();
    const result = composeActionPrompt({
      actionName: 'foo',
      completionEvent: 'bar_done',
      catalogRoot: root,
      overlay: { 'event.bar_done.post': 'only post' },
    });
    // No overlay for action.pre or event.pre — they collapse.
    // Step 1 = shipped action body, Step 2 = shipped event "when complete" block, Step 3 = post overlay.
    expect(result.prompt).toMatch(/^## Step 1\n\nfoo body\./);
    expect(result.prompt).toMatch(/## Step 2\n\n[\s\S]*Signal: bar_done/);
    expect(result.prompt).toMatch(/## Step 3\n\nonly post\s*$/);
    expect(result.has_custom_instructions).toBe(true);
  });

  it('returns has_custom_instructions=false when no overlay content is admitted', () => {
    const root = seedCatalog();
    const result = composeActionPrompt({
      actionName: 'foo',
      completionEvent: 'bar_done',
      catalogRoot: root,
    });
    expect(result.has_custom_instructions).toBe(false);
    // Shipped body still numbered.
    expect(result.prompt).toMatch(/^## Step 1\n\nfoo body\./);
    expect(result.prompt).toMatch(/## Step 2\n\n[\s\S]*Signal: bar_done/);
  });

  it('treats whitespace-only overlay content as absent for the flag (admission semantics)', () => {
    const root = seedCatalog();
    const result = composeActionPrompt({
      actionName: 'foo',
      completionEvent: 'bar_done',
      catalogRoot: root,
      overlay: { 'action.foo.pre': '   \n\n  ' },
    });
    expect(result.has_custom_instructions).toBe(false);
  });

  it('accepts a startStep input and starts numbering from that integer', () => {
    const root = seedCatalog();
    const result = composeActionPrompt({
      actionName: 'foo',
      completionEvent: null,
      catalogRoot: root,
      startStep: 2,
    });
    expect(result.prompt).toMatch(/^## Step 2\n\nfoo body\./);
  });

  it('terminal action (completionEvent=null) numbers only admitted sections', () => {
    const root = seedCatalog();
    const result = composeActionPrompt({
      actionName: 'foo',
      completionEvent: null,
      catalogRoot: root,
      overlay: { 'action.foo.pre': 'pre' },
    });
    expect(result.prompt).toMatch(/^## Step 1\n\npre\n\n## Step 2\n\nfoo body\.\s*$/);
    expect(result.has_custom_instructions).toBe(true);
  });
});

describe('composeOrphanEventPrompt — Step-N numbering and flag', () => {
  it('numbers admitted sections sequentially from Step 1 and reports has_custom_instructions', () => {
    const root = seedCatalog();
    const result = composeOrphanEventPrompt({
      eventName: 'kickoff',
      catalogRoot: root,
      overlay: { 'event.kickoff.post': 'post' },
    });
    expect(result.prompt).toMatch(/^## Step 1\n\n[\s\S]*Signal: kickoff/);
    expect(result.prompt).toMatch(/## Step 2\n\npost\s*$/);
    expect(result.has_custom_instructions).toBe(true);
  });
});

describe('deriveSignalLine — array-shaped flags (AD-3)', () => {
  it('renders an array flag as a single --repos <json> token', () => {
    const fm = {
      kind: 'event', name: 'task_completed', title: 'x', description: 'y',
      signal_payload: {
        repos: { required: true, array: true, description: 'per-repo commit results' },
      },
    } as unknown as EventFrontmatter;
    expect(deriveSignalLine('task_completed', fm))
      .toBe("Signal: task_completed --repos '<json>'");
  });

  it('keeps scalar flags rendered as --flag <value>', () => {
    const fm = {
      kind: 'event', name: 'phase_review_completed', title: 'x', description: 'y',
      signal_payload: {
        'doc-path': { required: true, description: 'path' },
        phase: { required: false, description: 'phase' },
      },
    } as unknown as EventFrontmatter;
    expect(deriveSignalLine('phase_review_completed', fm))
      .toBe('Signal: phase_review_completed --doc-path <value> --phase <value>');
  });
});
