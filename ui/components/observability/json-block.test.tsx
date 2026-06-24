import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JsonBlock } from './json-block';
Object.assign(globalThis, { React });

const FALLBACK = createElement('span', { 'data-fallback': '' }, 'raw');
const block = (text: string) =>
  renderToStaticMarkup(createElement(JsonBlock, { text, fallback: FALLBACK }));

test('structured JSON renders indented, syntax-highlighted spans', () => {
  const html = block('{"file_path":"/x/y.tsx","count":42}');
  assert.ok(html.includes('text-foreground font-medium'), 'key span class present');
  assert.ok(html.includes('text-chart-2'), 'number span class present');
  assert.ok(html.includes('\n'), 'output is re-indented (contains a newline)');
  assert.ok(!html.includes('data-fallback'), 'fallback not rendered for valid JSON');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (house tokens only)');
});

test('non-JSON text renders the fallback verbatim', () => {
  const html = block('plain bash output');
  assert.ok(html.includes('data-fallback'), 'fallback rendered');
  assert.ok(!html.includes('text-chart-2'), 'no token spans for non-JSON');
});

test('bare scalars fall through to the fallback', () => {
  assert.ok(block('42').includes('data-fallback'), 'bare number → fallback');
  assert.ok(block('"hi"').includes('data-fallback'), 'bare string → fallback');
});

test('empty string renders the fallback', () => {
  assert.ok(block('').includes('data-fallback'), 'empty → fallback');
});
