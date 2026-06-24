import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichText } from './rich-text';
Object.assign(globalThis, { React });

test('mono variant preserves newlines verbatim with pre-wrap (FR-6, DD-4)', () => {
  const html = renderToStaticMarkup(
    createElement(RichText, { body: 'line one\nline two', variant: 'mono' }),
  );
  assert.ok(html.includes('whitespace-pre-wrap'), 'mono uses pre-wrap');
  assert.ok(html.includes('font-mono'), 'mono uses a monospace font');
  assert.ok(html.includes('line one\nline two'), 'raw newlines preserved verbatim');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-1)');
});

test('prose variant renders bold, inline code, and list items (FR-6, DD-4)', () => {
  const body = '**Files modified:**\n\n- `a.tsx` changed\n- `b.css` changed';
  const html = renderToStaticMarkup(createElement(RichText, { body, variant: 'prose' }));
  assert.ok(html.includes('<strong'), 'bold rendered as <strong>');
  assert.ok(html.includes('Files modified:'), 'bold text content present');
  assert.ok(html.includes('<code'), 'inline code rendered as <code>');
  assert.ok(html.includes('<ul') && html.includes('<li'), 'bullet list rendered');
  assert.ok(html.includes('a.tsx'), 'list item content present');
});

test('truncated flag renders an inline marker, otherwise none (FR-6, DD-6)', () => {
  const capped = renderToStaticMarkup(
    createElement(RichText, { body: 'partial', variant: 'mono', truncated: true }),
  );
  assert.ok(/truncat/i.test(capped), 'marker shown when truncated');
  const whole = renderToStaticMarkup(
    createElement(RichText, { body: 'whole', variant: 'mono' }),
  );
  assert.ok(!/truncat/i.test(whole), 'no marker when not truncated');
});
