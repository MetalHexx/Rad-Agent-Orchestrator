import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reviewingView } from './reviewing-view';

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'reviewing-view.tsx'), 'utf-8');

// ─── source shape ─────────────────────────────────────────────────────────────

test('reviewing view id is "reviewing"', () => {
  assert.equal(reviewingView.id, 'reviewing');
});

test('reviewing view plots task progress, not phase completion', () => {
  assert.match(source, /deriveRingArc\(ctx\.taskProgress\)/);
  assert.ok(!source.includes('ctx.phaseProgress'), 'the work-state ring must not read phase progress');
});

test('reviewing view renders a commit chip', () => {
  assert.match(source, /CommitChips/);
});

test('reviewing view tints its doc controls to the purple review tier', () => {
  assert.match(source, /--tier-review/);
});

test('reviewing view renders both the Task Handoff and Code Review doc links', () => {
  assert.match(source, /label="Task Handoff"/);
  assert.match(source, /label="Code Review"/);
});

test('reviewing view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});
