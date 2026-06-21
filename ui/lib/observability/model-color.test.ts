import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, modelColor, MODEL_TOKENS } from './model-color';

test('normalizes harness-specific ids to a stable slot key (DD-2)', () => {
  assert.equal(normalizeModel('claude-opus-4-8'), 'opus');
  assert.equal(normalizeModel('claude-3-5-sonnet'), 'sonnet');
  assert.equal(normalizeModel('claude-haiku-4-5'), 'haiku');
  assert.equal(normalizeModel('gpt-5-codex'), 'gpt-5-codex');
});

test('maps known models to their pinned tokens (DD-1, DD-2)', () => {
  assert.equal(modelColor('claude-opus-4-8'), '--model-red');
  assert.equal(modelColor('claude-3-5-sonnet'), '--model-amber');
  assert.equal(modelColor('claude-haiku-4-5'), '--model-green');
});

test('unmapped models get a deterministic, stable house token (NFR-1, DD-2)', () => {
  const a = modelColor('gpt-5-codex');
  const b = modelColor('gpt-5-codex');
  assert.equal(a, b, 'same model id → same color across calls');
  assert.ok((MODEL_TOKENS as readonly string[]).includes(a), 'fallback color is one of the reserved house slots');
});
