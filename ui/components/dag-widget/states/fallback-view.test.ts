import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fallbackView } from './fallback-view';

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'fallback-view.tsx'), 'utf-8');

test('fallback view id is "fallback"', () => {
  assert.equal(fallbackView.id, 'fallback');
});

test('fallback view renders the node display name as heading with a fixed "Pipeline node" meta', () => {
  assert.match(source, /const meta = 'Pipeline node'/);
  assert.match(source, /<HeadingSlot\s+heading=\{heading\}\s+hasMeta=\{meta !== null\}\s*\/>/);
  assert.match(source, /<MetaSlot\s+meta=\{meta\}\s*\/>/);
});

test('fallback view renders no badge', () => {
  assert.ok(!source.includes('SpinnerBadge'));
});

test('fallback view renders no commit chip', () => {
  assert.ok(!source.includes('CommitChips'));
});

test('fallback view mounts an empty controls slot — still floors its height', () => {
  assert.match(source, /<ControlsSlot\s*\/>/);
});

test('fallback view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});
