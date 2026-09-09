import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeOrphanEventPrompt } from '../../../src/lib/pipeline-engine/composer.js';

function seed(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-orphan-'));
  fs.mkdirSync(path.join(root, 'custom'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'event.lonely.md'),
    '---\nkind: event\nname: lonely\ntitle: Lonely\ndescription: An orphan event.\nsignal_payload:\n  reason:\n    required: true\n    description: why\n---\n\nLonely body.\n',
  );
  return root;
}

test('composeOrphanEventPrompt closes with the shape-only completion block', () => {
  const root = seed();
  const out = composeOrphanEventPrompt({ eventName: 'lonely', catalogRoot: root });
  expect(out.prompt).toContain('`lonely`');
  expect(out.prompt).toContain('`--reason`');
  expect(out.prompt).not.toContain('Signal:');
});

test('composeOrphanEventPrompt renders only event-context sections (AD-3, FR-32)', () => {
  const root = seed();
  fs.writeFileSync(path.join(root, 'custom', 'event.lonely.pre.md'), 'ORPHAN PRE\n');
  fs.writeFileSync(path.join(root, 'custom', 'event.lonely.post.md'), 'ORPHAN POST\n');
  const out = composeOrphanEventPrompt({ eventName: 'lonely', catalogRoot: root });
  expect(out.prompt).toMatch(/ORPHAN PRE/);
  expect(out.prompt).toMatch(/Lonely body\./);
  expect(out.prompt).toMatch(/`--reason`/);
  expect(out.prompt).toMatch(/ORPHAN POST/);
  expect(out.prompt).not.toMatch(/^## Before doing this action/m);
});

test('composeOrphanEventPrompt honors overlay (AD-3)', () => {
  const root = seed();
  const out = composeOrphanEventPrompt({
    eventName: 'lonely',
    catalogRoot: root,
    overlay: { 'event.lonely.post': 'OVERRIDE POST' },
  });
  expect(out.prompt).toMatch(/OVERRIDE POST/);
});
