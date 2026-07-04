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

test('reviewing view renders no badge', () => {
  assert.ok(!source.includes('SpinnerBadge'), 'the badge is retired in favor of the heading/meta anatomy');
});

test('reviewing view heading/meta are sourced from deriveCardHeading, not composed inline', () => {
  assert.match(source, /deriveCardHeading\(ctx\)/);
  assert.match(source, /<HeadingSlot\s+heading=\{heading\}\s+hasMeta=\{meta !== null\}\s*\/>/);
  assert.match(source, /<MetaSlot\s+meta=\{meta\}\s*\/>/);
});

test('reviewing view wraps its controls in CardControlsRow and uses DocButton, not DocumentLink', () => {
  assert.match(source, /CardControlsRow/);
  assert.match(source, /DocButton/);
  assert.ok(!source.includes('DocumentLink'), 'the text doc link is retired in favor of the real button');
});

test('reviewing view surfaces no corrective-only doc control', () => {
  assert.ok(!source.includes('Review Report'));
});

test('reviewing view ring center carries a "TASK REVIEW" sublabel', () => {
  assert.match(source, /sublabel="TASK REVIEW"/);
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
