import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeJson, tryTokenizeJson } from './pretty-json';

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

test('tryTokenizeJson tokenizes a structured JSON object string', () => {
  const toks = tryTokenizeJson('{"a":"hi","n":42}');
  assert.ok(toks, 'object string yields tokens');
  const kinds = new Set(toks!.map((t) => t.kind));
  assert.ok(kinds.has('key') && kinds.has('string') && kinds.has('number'), 'key/string/number tokens produced');
  assert.ok(toks!.some((t) => t.text.includes('\n')), 're-indented with newlines');
});

test('tryTokenizeJson tokenizes a JSON array string', () => {
  const toks = tryTokenizeJson('[1,2,3]');
  assert.ok(toks && toks.some((t) => t.kind === 'number'), 'array string yields number tokens');
});

test('tryTokenizeJson returns null for non-JSON, scalars, and empty input', () => {
  assert.equal(tryTokenizeJson('plain bash output'), null, 'invalid JSON → null');
  assert.equal(tryTokenizeJson('42'), null, 'bare number → null');
  assert.equal(tryTokenizeJson('"hi"'), null, 'bare string → null');
  assert.equal(tryTokenizeJson('true'), null, 'bare boolean → null');
  assert.equal(tryTokenizeJson('null'), null, 'bare null → null');
  assert.equal(tryTokenizeJson(''), null, 'empty string → null');
});
