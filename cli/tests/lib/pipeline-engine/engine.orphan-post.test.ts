import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isOrphanEvent,
  readOrphanPostContent,
  attachPromptIfActionResolved,
  __setActionEventsRootForTests,
} from '../../../src/lib/pipeline-engine/engine.js';
import * as composerModule from '../../../src/lib/pipeline-engine/composer.js';
import { composeOrphanRuntimeShape } from '../../../src/lib/pipeline-engine/composer.js';
import type { PipelineTemplate } from '../../../src/lib/pipeline-engine/types.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function seedRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-orphan-post-'));
  fs.mkdirSync(path.join(root, 'custom'), { recursive: true });
  // Action whose completion event is `bar_done` — establishes bar_done as a
  // NON-orphan event for the orphan-check.
  fs.writeFileSync(path.join(root, 'action.foo.md'),
    '---\nkind: action\nname: foo\ntitle: Foo\ndescription: Run foo.\ncategory: agent-spawn\ncompletion_event: bar_done\n---\n\nfoo body.\n');
  fs.writeFileSync(path.join(root, 'event.bar_done.md'),
    '---\nkind: event\nname: bar_done\ntitle: Bar Done\ndescription: bar done signal.\nsignal_payload: {}\n---\n\nbar done event body.\n');
  // Orphan event — no action references it as completion_event.
  fs.writeFileSync(path.join(root, 'event.kickoff.md'),
    '---\nkind: event\nname: kickoff\ntitle: Kickoff\ndescription: kickoff signal.\nsignal_payload: {}\n---\n\nkickoff event body.\n');
  __setActionEventsRootForTests(root);
  cleanups.push(() => {
    __setActionEventsRootForTests(null);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

describe('isOrphanEvent', () => {
  it('returns true for an event no action declares as completion_event', () => {
    seedRoot();
    expect(isOrphanEvent('kickoff')).toBe(true);
  });

  it('returns false for an event that IS some action\'s completion_event', () => {
    seedRoot();
    expect(isOrphanEvent('bar_done')).toBe(false);
  });

  it('returns true when the catalog root does not exist (no actions = nothing claims the event)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-orphan-empty-'));
    fs.rmSync(tmp, { recursive: true, force: true });
    __setActionEventsRootForTests(tmp);
    cleanups.push(() => { __setActionEventsRootForTests(null); });
    expect(isOrphanEvent('anything')).toBe(true);
  });
});

describe('readOrphanPostContent', () => {
  it('returns trimmed content when the post custom file exists and is non-empty', () => {
    const root = seedRoot();
    fs.writeFileSync(path.join(root, 'custom', 'event.kickoff.post.md'), '  hello kickoff\n\n');
    expect(readOrphanPostContent('kickoff')).toBe('hello kickoff');
  });

  it('returns null when the post custom file does not exist', () => {
    seedRoot();
    expect(readOrphanPostContent('kickoff')).toBeNull();
  });

  it('returns null when the post custom file exists but is empty after trim', () => {
    const root = seedRoot();
    fs.writeFileSync(path.join(root, 'custom', 'event.kickoff.post.md'), '   \n\n  ');
    expect(readOrphanPostContent('kickoff')).toBeNull();
  });
});

describe('composeOrphanRuntimeShape — preview/runtime parity', () => {
  it('emits ## Step 1 with the orphan-post content and a labeled next-action placeholder', () => {
    const root = seedRoot();
    fs.writeFileSync(path.join(root, 'custom', 'event.kickoff.post.md'), 'rant before next');
    const result = composeOrphanRuntimeShape({ eventName: 'kickoff', catalogRoot: root });
    expect(result.prompt).toBe(
      '## Step 1\n\nrant before next\n\n← the next action\'s prompt is composed here at runtime'
    );
    expect(result.has_custom_instructions).toBe(true);
  });

  it('renders the no-overlay-content placeholder when the orphan-post is absent or whitespace-only', () => {
    const root = seedRoot();
    const result = composeOrphanRuntimeShape({ eventName: 'kickoff', catalogRoot: root });
    expect(result.prompt).toBe(
      '(no overlay content)\n\n← the next action\'s prompt is composed here at runtime'
    );
    expect(result.has_custom_instructions).toBe(false);
  });
});

describe('attachPromptIfActionResolved — Step-N renumbering and envelope flag', () => {
  const dummyTemplate = {} as unknown as PipelineTemplate;

  it('prepends orphan-post as ## Step 1 and renumbers downstream sections starting at ## Step 2', () => {
    const root = seedRoot();
    fs.writeFileSync(path.join(root, 'custom', 'event.kickoff.post.md'), 'pre-next instructions');
    const result = attachPromptIfActionResolved(
      { action: 'foo', context: {} },
      dummyTemplate,
      'kickoff',
      '/tmp/engine-orphan-post',
    );
    expect(result.prompt).toMatch(/^## Step 1\n\npre-next instructions\n\n## Step 2\n\nfoo body\./);
    expect(result.prompt).toMatch(/## Step 3\n\n[\s\S]*Signal: bar_done/);
    expect(result.has_custom_instructions).toBe(true);
  });

  it('does not prepend or claim custom when the orphan-post file is absent', () => {
    seedRoot();
    const result = attachPromptIfActionResolved(
      { action: 'foo', context: {} },
      dummyTemplate,
      'kickoff',
      '/tmp/engine-orphan-post',
    );
    expect(result.prompt as string).toMatch(/^## Step 1\n\nfoo body\./);
    expect(result.has_custom_instructions).toBe(false);
  });

  it('sets has_custom_instructions=true when the composer admits overlay content even without orphan-prepend', () => {
    const root = seedRoot();
    fs.writeFileSync(path.join(root, 'custom', 'action.foo.pre.md'), 'pre-action prose');
    const result = attachPromptIfActionResolved(
      { action: 'foo', context: {} },
      dummyTemplate,
      'bar_done', // non-orphan
      '/tmp/engine-orphan-post',
    );
    expect(result.has_custom_instructions).toBe(true);
  });

  it('sets has_custom_instructions=false when only shipped catalog content composed', () => {
    seedRoot();
    const result = attachPromptIfActionResolved(
      { action: 'foo', context: {} },
      dummyTemplate,
      'bar_done',
      '/tmp/engine-orphan-post',
    );
    expect(result.has_custom_instructions).toBe(false);
  });
});

describe('attachPromptIfActionResolved — non-orphan event double-include guard', () => {
  const dummyTemplate = {} as unknown as PipelineTemplate;

  it('does NOT prepend event.X.post when firing event X is non-orphan (avoids double-include)', () => {
    const root = seedRoot();
    // Author both an event.bar_done.post.md (which composer ALREADY includes via
    // the action's post slot) AND verify the engine does not also prepend it.
    fs.writeFileSync(path.join(root, 'custom', 'event.bar_done.post.md'), 'bar_done aftermath');
    const result = attachPromptIfActionResolved(
      { action: 'foo', context: {} },
      dummyTemplate,
      'bar_done',
      '/tmp/engine-orphan-post',
    );
    expect(result.prompt).toBeDefined();
    // The composed action prompt includes bar_done aftermath exactly once (from the
    // composer's post-event slot), not prepended again at the top.
    const matches = (result.prompt as string).match(/bar_done aftermath/g) ?? [];
    expect(matches.length).toBe(1);
    // The prompt starts with the action body section (## Step 1).
    expect(result.prompt as string).toMatch(/^## Step 1/);
  });

  it('does NOT prepend when the orphan event has no post custom on disk', () => {
    seedRoot();
    const result = attachPromptIfActionResolved(
      { action: 'foo', context: {} },
      dummyTemplate,
      'kickoff',
      '/tmp/engine-orphan-post',
    );
    expect(result.prompt).toBeDefined();
    expect(result.prompt as string).not.toMatch(/^## After signaling/);
  });

  it('returns the empty-action envelope when next is null (no spurious prepend)', () => {
    seedRoot();
    const result = attachPromptIfActionResolved(null, dummyTemplate, 'kickoff', '/tmp/engine-orphan-post');
    expect(result).toEqual({ action: null, context: {} });
  });
});

describe('attachPromptIfActionResolved — calls composeOrphanRuntimeShape via spy', () => {
  const dummyTemplate = {} as unknown as PipelineTemplate;

  it('calls composeOrphanRuntimeShape at least once and preserves byte parity for orphan-prepend path', () => {
    const root = seedRoot();
    fs.writeFileSync(path.join(root, 'custom', 'event.kickoff.post.md'), 'pre-next instructions');

    const spy = vi.spyOn(composerModule, 'composeOrphanRuntimeShape');

    const result = attachPromptIfActionResolved(
      { action: 'foo', context: {} },
      dummyTemplate,
      'kickoff',
      '/tmp/engine-orphan-post',
    );

    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(result.prompt).toMatch(/^## Step 1\n\npre-next instructions\n\n## Step 2\n\nfoo body\./);

    spy.mockRestore();
  });
});
