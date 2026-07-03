import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('the shell owns the three-slot geometry and imports the resolver', () => {
  assert.match(shell, /resolveStateView/, 'shell resolves the active view via the resolver');
  assert.match(shell, /ring/, 'shell grid names the ring slot');
  assert.match(shell, /title/, 'shell grid names the title slot');
  assert.match(shell, /controls/, 'shell grid names the controls slot');
  assert.match(shell, /gridTemplate|grid-template/, 'shell defines the slot grid template');
});

test('state views are geometry-free — the fallback sets no slot geometry', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(fallback), 'fallback view sets no grid geometry');
  assert.ok(!fallback.includes('RING_DIAMETER'), 'fallback view does not size the ring slot');
  assert.match(fallback, /RingSlot|TitleSlot/, 'fallback view fills slots via the shared slot wrappers');
});

test('slot geometry lives once in the slot module', () => {
  assert.match(cardSlots, /gridArea/, 'slot wrappers claim named grid areas');
  assert.match(cardSlots, /RING_DIAMETER/, 'slot module owns the fixed ring diameter');
});

test('the view registry is a lookup, not a switch ladder over node ids', () => {
  assert.match(resolver, /REGISTRY|Record<StateId/, 'a keyed registry backs resolution');
  assert.ok(!/\bswitch\s*\(/.test(resolver), 'resolver uses no switch statement');
});

test('the card family never references the .live-pulse-* affordance', () => {
  for (const [name, src] of Object.entries(ALL_SOURCES)) {
    assert.ok(!src.includes('live-pulse'), `${name} must not reference live-pulse`);
  }
});

test('reduced motion is honored by the shell', () => {
  assert.match(shell, /prefers-reduced-motion/, 'shell reads the reduced-motion preference');
});

test('the ring routes its recharts primitives through the compat shim', () => {
  assert.match(ring, /recharts-compat/, 'RadialBar / PolarAngleAxis come from the FC-typed shim');
  assert.ok(!/as\s+unknown\s+as|as\s+any/.test(ring), 'no ad-hoc casts in the ring');
});
