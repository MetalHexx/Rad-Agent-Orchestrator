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

test('coding view renders no badge', () => {
  assert.ok(!source.includes('SpinnerBadge'), 'the badge is retired in favor of the heading/meta anatomy');
});

test('coding view heading/meta are sourced from deriveCardHeading, not composed inline', () => {
  assert.match(source, /deriveCardHeading\(ctx\)/);
  assert.match(source, /<HeadingSlot\s+heading=\{heading\}\s+hasMeta=\{meta !== null\}\s*\/>/);
  assert.match(source, /<MetaSlot\s+meta=\{meta\}\s*\/>/);
});

test('coding view wraps its controls in CardControlsRow and uses DocButton, not DocumentLink', () => {
  assert.match(source, /CardControlsRow/);
  assert.match(source, /DocButton/);
  assert.ok(!source.includes('DocumentLink'), 'the text doc link is retired in favor of the real button');
});

test('coding view surfaces only the Task Handoff doc control alongside the commit chip', () => {
  assert.ok(!source.includes('Code Review'));
  assert.ok(!source.includes('Review Report'));
});

test('coding view ring center carries a "TASK" sublabel', () => {
  assert.match(source, /sublabel="TASK"/);
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
