import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextHoldState, type HoldState } from './hold-floor';

const FLOOR = 300;
const IDLE: HoldState = { shownAt: null };

test('an appearing placeholder is held and records when it appeared', () => {
  const r = nextHoldState(IDLE, true, 1_000, FLOOR);
  assert.equal(r.held, true);
  assert.equal(r.state.shownAt, 1_000);
  assert.equal(r.wakeInMs, null);
});

test('a condition that clears before the floor keeps the placeholder held and asks to be woken for the remainder', () => {
  const shown = nextHoldState(IDLE, true, 1_000, FLOOR);
  const r = nextHoldState(shown.state, false, 1_100, FLOOR);
  assert.equal(r.held, true);
  assert.equal(r.wakeInMs, 200);
  assert.equal(r.state.shownAt, 1_000, 'the appearance time must survive so the floor is measured from it');
});

test('the placeholder is released once the floor has elapsed', () => {
  const shown = nextHoldState(IDLE, true, 1_000, FLOOR);
  const r = nextHoldState(shown.state, false, 1_000 + FLOOR, FLOOR);
  assert.equal(r.held, false);
  assert.equal(r.wakeInMs, null);
  assert.equal(r.state.shownAt, null, 'a released placeholder starts a fresh floor next time it appears');
});

test('a condition still true past the floor stays held with nothing pending — the floor never delays a slower fetch', () => {
  const shown = nextHoldState(IDLE, true, 1_000, FLOOR);
  const r = nextHoldState(shown.state, true, 5_000, FLOOR);
  assert.equal(r.held, true);
  assert.equal(r.wakeInMs, null);
  assert.equal(r.state.shownAt, 1_000);
});

test('an idle placeholder with an inactive condition stays released', () => {
  const r = nextHoldState(IDLE, false, 1_000, FLOOR);
  assert.equal(r.held, false);
  assert.equal(r.wakeInMs, null);
  assert.equal(r.state.shownAt, null);
});
