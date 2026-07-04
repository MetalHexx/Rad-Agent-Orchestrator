import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf-8');

const shell = read('dag-state-card.tsx');
const resolver = read('resolver.ts');
const fallback = read('states/fallback-view.tsx');
const cardSlots = read('card-slots.tsx');
const ring = read('ring.tsx');

const ALL_SOURCES = { shell, resolver, fallback, cardSlots, ring };

const statesDir = join(dir, 'states');
const STATE_VIEW_FILES = readdirSync(statesDir).filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));

test('the shell owns the four-region geometry and imports the resolver', () => {
  assert.match(shell, /resolveStateView/, 'shell resolves the active view via the resolver');
  assert.match(shell, /ring/, 'shell grid names the ring slot');
  assert.match(shell, /heading/, 'shell grid names the heading slot');
  assert.match(shell, /meta/, 'shell grid names the meta slot');
  assert.match(shell, /controls/, 'shell grid names the controls slot');
  assert.match(shell, /gridTemplate|grid-template/, 'shell defines the slot grid template');
});

test('state views are geometry-free — the fallback sets no slot geometry', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(fallback), 'fallback view sets no grid geometry');
  assert.ok(!fallback.includes('RING_DIAMETER'), 'fallback view does not size the ring slot');
  assert.match(fallback, /RingSlot/, 'fallback view fills slots via the shared slot wrappers');
});

test('slot geometry lives once in the slot module', () => {
  assert.match(cardSlots, /gridArea/, 'slot wrappers claim named grid areas');
  assert.match(cardSlots, /RING_DIAMETER/, 'slot module owns the fixed ring diameter');
});

test('the view registry is a lookup, not a switch ladder over node ids', () => {
  assert.match(resolver, /REGISTRY|Record<StateId/, 'a keyed registry backs resolution');
  assert.ok(!/\bswitch\s*\(/.test(resolver), 'resolver uses no switch statement');
});

test('no state view renders a spinner/state badge — the heading/meta anatomy replaces it', () => {
  assert.ok(STATE_VIEW_FILES.length > 0, 'sanity: the states directory is not empty');
  for (const file of STATE_VIEW_FILES) {
    const src = readFileSync(join(statesDir, file), 'utf-8');
    assert.ok(!src.includes('SpinnerBadge'), `${file} must not render a SpinnerBadge`);
    assert.ok(!src.includes('Badge'), `${file} must not render any state badge`);
  }
});

test('the plumbing nodes fold into their nearest meaningful state instead of the fallback', () => {
  assert.match(resolver, /explode_master_plan:\s*'planning'/, 'explode_master_plan folds into the planning card');
  for (const nodeId of ['final_approval_gate', 'pr_gate', 'final_pr']) {
    assert.match(resolver, new RegExp(`${nodeId}:\\s*'final-review'`), `${nodeId} folds into the final-review card`);
  }

  const skipSetMatch = resolver.match(/SKIP_STATE_NODE_IDS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(skipSetMatch, 'resolver declares SKIP_STATE_NODE_IDS as a Set literal');
  const skipSetBody = skipSetMatch![1];
  for (const nodeId of ['explode_master_plan', 'final_approval_gate', 'pr_gate', 'final_pr']) {
    assert.ok(
      !skipSetBody.includes(`'${nodeId}'`),
      `${nodeId} must not remain in the skip-set now that it folds into a real state`,
    );
  }
});

test('the card family never references the .live-pulse-* affordance', () => {
  for (const [name, src] of Object.entries(ALL_SOURCES)) {
    assert.ok(!src.includes('live-pulse'), `${name} must not reference live-pulse`);
  }
});

test('reduced motion is honored by the shell', () => {
  assert.match(shell, /prefers-reduced-motion/, 'shell reads the reduced-motion preference');
});

test('the shell crossfades content in AND out across a state change, then unmounts the outgoing layer', () => {
  // A true crossfade, not a one-sided fade-in: the incoming state fades in
  // while the previous state's frozen snapshot fades out beneath it, stacked
  // in one overlap cell so the frame never jumps.
  assert.match(shell, /animate-in\s+fade-in/, 'incoming content fades in');
  assert.match(shell, /animate-out\s+fade-out/, 'outgoing content fades out');
  assert.match(shell, /onAnimationEnd/, 'the outgoing layer unmounts once its fade completes');
  assert.match(shell, /!reduced/, 'the whole crossfade is gated on the reduced-motion preference');
});

test('the ring routes its recharts primitives through the compat shim', () => {
  assert.match(ring, /recharts-compat/, 'RadialBar / PolarAngleAxis come from the FC-typed shim');
  assert.ok(!/as\s+unknown\s+as|as\s+any/.test(ring), 'no ad-hoc casts in the ring');
});

test('the heading/meta block anchors as a tight pair beside the full-height centered ring, not a fixed-height floor', () => {
  assert.ok(!cardSlots.includes('min-h-16'), 'the fixed title-row floor is retired for the centered-ring model');
  assert.match(cardSlots, /export function HeadingSlot/, 'card-slots exports the single-line HeadingSlot');
  assert.match(cardSlots, /export function MetaSlot/, 'card-slots exports the MetaSlot');
  assert.match(cardSlots, /gridArea:\s*'ring'[^}]*alignSelf:\s*'center'/, 'RingSlot centers vertically within its full-height spanning column');
  assert.match(cardSlots, /gridArea:\s*'heading'[^}]*alignSelf:\s*'end'/, 'HeadingSlot anchors to the end of its flexible row');
  assert.match(cardSlots, /gridArea:\s*'meta'[^}]*alignSelf:\s*'start'/, 'MetaSlot anchors to the start of its flexible row, flush against the heading');
});
