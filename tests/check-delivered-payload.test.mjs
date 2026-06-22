import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPayloadLeaks } from './check-delivered-payload.mjs';

test('flags a dev-only skill leaked into the delivered set', () => {
  const leaks = findPayloadLeaks(['rad-brainstorm', 'rad-ui-start', 'rad-ui-dev', 'tests']);
  assert.deepEqual(leaks.sort(), ['rad-ui-dev', 'tests']);
});

test('passes a clean delivered set', () => {
  const leaks = findPayloadLeaks(['rad-brainstorm', 'rad-ui-start', 'rad-plan']);
  assert.deepEqual(leaks, []);
});
