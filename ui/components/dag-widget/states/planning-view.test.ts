import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { planningView } from './planning-view';

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'planning-view.tsx'), 'utf-8');

test('planning view id is "planning"', () => {
  assert.equal(planningView.id, 'planning');
});

test('planning view renders an indeterminate ring', () => {
  assert.match(source, /mode="indeterminate"/);
});

test('planning view tints its ring to the blue planning tier', () => {
  assert.match(source, /--tier-planning/);
});

test('planning view renders no commit chip', () => {
  assert.ok(!source.includes('CommitChips'));
});

test('planning view renders no controls slot — no docs, no commit', () => {
  assert.ok(!source.includes('ControlsSlot'));
});

test('planning view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});
