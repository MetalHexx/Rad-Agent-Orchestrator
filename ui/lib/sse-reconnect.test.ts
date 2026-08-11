import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReconnectDelay, BACKOFF_INITIAL_MS, BACKOFF_MAX_MS } from './sse-reconnect';

test('a null previous delay (before the first retry) starts at the initial delay', () => {
  assert.equal(nextReconnectDelay(null), BACKOFF_INITIAL_MS);
});

test('escalation doubles the previous delay', () => {
  assert.equal(nextReconnectDelay(1000), 2000);
  assert.equal(nextReconnectDelay(2000), 4000);
  assert.equal(nextReconnectDelay(4000), 8000);
});

test('the cap holds at 30s across many successive calls', () => {
  let delay: number | null = null;
  for (let i = 0; i < 20; i++) {
    delay = nextReconnectDelay(delay);
  }
  assert.equal(delay, BACKOFF_MAX_MS);
  // One more call past the cap must not overshoot it.
  assert.equal(nextReconnectDelay(delay), BACKOFF_MAX_MS);
});

test('never returns a give-up value — always a positive delay', () => {
  const samples = [null, 1000, 5000, 30000, 60000];
  for (const s of samples) {
    const d = nextReconnectDelay(s);
    assert.equal(typeof d, 'number');
    assert.ok(d > 0);
  }
});
