import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeJson } from './pretty-json';

test('tokenizes keys, strings, numbers, and punctuation into classed spans (FR-7)', () => {
  const toks = tokenizeJson({ a: 'hi', n: 42 });
  const kinds = new Set(toks.map((t) => t.kind));
  assert.ok(kinds.has('key') && kinds.has('string') && kinds.has('number') && kinds.has('punct'),
    'all four token kinds are produced');
});

test('renders truncation markers verbatim, no escape hatch (FR-8)', () => {
  const toks = tokenizeJson({ result: { text: 'partial…', truncated: true, fullBytes: 20480 } });
  const flat = toks.map((t) => t.text).join('');
  assert.ok(flat.includes('"truncated"') && flat.includes('true') && flat.includes('20480'),
    'truncated + fullBytes markers appear verbatim in the rendered JSON');
});

test('token classes are house tokens, never literal hex (NFR-4)', () => {
  const toks = tokenizeJson({ a: 1 });
  assert.ok(toks.every((t) => !/#[0-9a-fA-F]{6}/.test(t.className ?? '')), 'no hex in token classNames');
});
