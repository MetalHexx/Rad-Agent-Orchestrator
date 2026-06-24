import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventKindColor, eventKindLabel } from './event-kind-color';

const ev = (over: Record<string, unknown>) => ({ seq: 1, timestamp: '', ...over }) as never;

test('maps each themed kind to its house token (DD-2, AD-3)', () => {
  assert.equal(eventKindColor(ev({ kind: 'message', role: 'user' })), '--model-grey');
  assert.equal(eventKindColor(ev({ kind: 'message', role: 'assistant' })), '--chart-2');
  assert.equal(eventKindColor(ev({ kind: 'thinking' })), '--model-purple');
  assert.equal(eventKindColor(ev({ kind: 'tool_call' })), '--model-teal');
  assert.equal(eventKindColor(ev({ kind: 'tool_result', result: { toolUseId: 'x', output: { text: '' }, isError: false } })), '--model-green');
  assert.equal(eventKindColor(ev({ kind: 'tool_result', result: { toolUseId: 'x', output: { text: '' }, isError: true } })), '--model-red');
  assert.equal(eventKindColor(ev({ kind: 'file_change', file: { path: 'a', op: 'edit' } })), '--model-amber');
});

test('un-themed kinds fall back to neutral grey, never dropped (AD-7)', () => {
  assert.equal(eventKindColor(ev({ kind: 'system' })), '--model-grey');
  assert.equal(eventKindColor(ev({ kind: 'hook' })), '--model-grey');
  assert.equal(eventKindLabel(ev({ kind: 'system' })), 'System');
});

test('labels read human; error result is distinct (DD-2, DD-3)', () => {
  assert.equal(eventKindLabel(ev({ kind: 'message', role: 'assistant' })), 'Assistant');
  assert.equal(eventKindLabel(ev({ kind: 'tool_result', result: { toolUseId: 'x', output: { text: '' }, isError: true } })), 'Result · error');
});
