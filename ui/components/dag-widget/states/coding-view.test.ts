import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { codingView } from './coding-view';

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'coding-view.tsx'), 'utf-8');

// ─── source shape ─────────────────────────────────────────────────────────────

test('coding view id is "coding"', () => {
  assert.equal(codingView.id, 'coding');
});

test('coding view plots task progress, not phase completion', () => {
  assert.match(source, /deriveRingArc\(ctx\.taskProgress\)/);
  assert.ok(!source.includes('ctx.phaseProgress'), 'the work-state ring must not read phase progress');
});

test('coding view renders a commit chip', () => {
  assert.match(source, /CommitChips/);
});

test('coding view tints its doc controls to the amber execution tier', () => {
  assert.match(source, /--tier-execution/);
});

test('coding view renders the Task Handoff doc link', () => {
  assert.match(source, /label="Task Handoff"/);
});

test('coding view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});
