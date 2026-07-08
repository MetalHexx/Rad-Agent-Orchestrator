import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNearBottom, nextNewCountOnContentChanged, useStickToBottom } from './use-stick-to-bottom';
import type { UseStickToBottomReturn } from './use-stick-to-bottom';

// ─── isNearBottom — pure DOM-measurement math, no jsdom required ─────────────

test('isNearBottom: at the very bottom (distance 0) is near-bottom', () => {
  assert.equal(isNearBottom({ scrollTop: 952, scrollHeight: 1000, clientHeight: 48 }, 48), true);
});

test('isNearBottom: scrolled up well beyond the threshold is NOT near-bottom', () => {
  assert.equal(isNearBottom({ scrollTop: 200, scrollHeight: 1000, clientHeight: 48 }, 48), false);
});

test('isNearBottom: distance exactly equal to the threshold counts as near-bottom (inclusive)', () => {
  // distanceFromBottom = 1000 - 904 - 48 = 48 === thresholdPx
  assert.equal(isNearBottom({ scrollTop: 904, scrollHeight: 1000, clientHeight: 48 }, 48), true);
});

test('isNearBottom: one pixel past the threshold is NOT near-bottom', () => {
  // distanceFromBottom = 1000 - 903 - 48 = 49 > 48
  assert.equal(isNearBottom({ scrollTop: 903, scrollHeight: 1000, clientHeight: 48 }, 48), false);
});

test('isNearBottom: a short scroller (content fits, no scrollbar) is always near-bottom', () => {
  assert.equal(isNearBottom({ scrollTop: 0, scrollHeight: 100, clientHeight: 200 }, 48), true);
});

// ─── nextNewCountOnContentChanged — the engaged-state reducer for the
//     unseen-event counter used by notifyContentChanged ────────────────────

test('nextNewCountOnContentChanged: pinned resets the counter to 0 (about to auto-follow)', () => {
  assert.equal(nextNewCountOnContentChanged(true, 5), 0);
  assert.equal(nextNewCountOnContentChanged(true, 0), 0);
});

test('nextNewCountOnContentChanged: disengaged increments the counter by 1 per call', () => {
  assert.equal(nextNewCountOnContentChanged(false, 0), 1);
  assert.equal(nextNewCountOnContentChanged(false, 1), 2);
  assert.equal(nextNewCountOnContentChanged(false, 41), 42);
});

// ─── Exported surface ─────────────────────────────────────────────────────

test('useStickToBottom is exported as a function', () => {
  assert.equal(typeof useStickToBottom, 'function');
  // UseStickToBottomReturn is a type-only export — the compile-time import at
  // the top of this file verifies the name is exported.
  const _type: UseStickToBottomReturn | null = null;
  assert.equal(_type, null);
});
