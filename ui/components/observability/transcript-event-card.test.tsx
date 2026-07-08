import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptEventCard } from './transcript-event-card';
Object.assign(globalThis, { React });

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'transcript-event-card.tsx'), 'utf-8');

const card = (event: Record<string, unknown>, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(TranscriptEventCard, { event, ...props } as never));

test('renders kind label, clock, and a colored left border (DD-1, DD-3, FR-2)', () => {
  const html = card({ seq: 1, timestamp: '2026-06-24T09:08:07.000Z', kind: 'message', role: 'assistant', text: 'hello' });
  assert.ok(html.includes('Assistant'), 'assistant label present');
  assert.ok(html.includes('09:08:07'), 'clock rendered');
  assert.ok(html.includes('var(--chart-2)'), 'assistant border token applied');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-3)');
});

test('thinking renders italic muted; user renders plain text (DD-4)', () => {
  const t = card({ seq: 2, timestamp: '2026-06-24T09:00:00.000Z', kind: 'thinking', text: 'pondering' });
  assert.ok(t.includes('italic') && t.includes('pondering'), 'thinking italic body');
  const u = card({ seq: 3, timestamp: '2026-06-24T09:00:00.000Z', kind: 'message', role: 'user', text: 'do this' });
  assert.ok(u.includes('User') && u.includes('do this'), 'user label + text');
});

test('file_change shows op + filename, no diffstat (DD-4)', () => {
  const html = card({ seq: 4, timestamp: '2026-06-24T09:00:00.000Z', kind: 'file_change', file: { path: 'ui/x.tsx', op: 'write' } });
  assert.ok(/write/i.test(html) && html.includes('ui/x.tsx'), 'op + filename present');
});

test('un-themed system kind still renders a card, never dropped (AD-7)', () => {
  const html = card({ seq: 5, timestamp: '2026-06-24T09:00:00.000Z', kind: 'system', text: 'boot' });
  assert.ok(html.includes('System') && html.includes('var(--model-grey)'), 'system label + neutral border');
});

test('tool_call shows name + arg preview, never the toolUseId (FR-3, DD-4, AD-6)', () => {
  const html = card({ seq: 1, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_call', tool: { name: 'Grep', input: { text: 'pattern foo' }, toolUseId: 'toolu_secret' } });
  assert.ok(html.includes('Grep') && html.includes('pattern foo'), 'name + arg preview present');
  assert.ok(!html.includes('toolu_secret'), 'toolUseId never rendered (AD-6)');
});

test('tool_result renders a code block w/ line gutter; hidden when Tool I/O off (FR-3, FR-8, DD-6)', () => {
  const ev = { seq: 2, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_result', result: { toolUseId: 'x', output: { text: 'line a\nline b' }, isError: false } };
  const shown = card(ev, { showToolIO: true });
  assert.ok(shown.includes('line a') && shown.includes('line b'), 'output lines rendered');
  assert.ok(shown.includes('>1<') && shown.includes('>2<'), 'line-number gutter present');
  const hidden = card(ev, { showToolIO: false });
  assert.ok(!hidden.includes('line a'), 'output body hidden when Tool I/O off (FR-8)');
  assert.ok(hidden.includes('Result'), 'card header still present (DD-9)');
});

test('error result shows an error badge + red tint; truncation shows a warning badge (FR-5, DD-10)', () => {
  const err = card({ seq: 3, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_result', result: { toolUseId: 'x', output: { text: 'boom' }, isError: true } });
  assert.ok(/error/i.test(err) && err.includes('var(--model-red)'), 'error badge + red tint');
  const trunc = card({ seq: 4, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_result', result: { toolUseId: 'x', output: { text: 'partial', truncated: true, fullBytes: 20480 }, isError: false } });
  assert.ok(/truncated/i.test(trunc) && trunc.includes('20 KB'), 'truncation badge with human size');
});

// --- Revision 2026-06-24: wrapping tool-call args + per-card more/less reveal ---

test('long JSON tool-call args pretty-print and keep the full path — no mid-string truncation (Issue 1)', () => {
  const longPath = 'C:\\Users\\Metal\\.radorc\\worktrees\\TELEMETRY-5.5\\rad-orc-source\\ui\\components\\observability\\BUILD-AND-WIRE-OVERVIEW-FACET.md';
  // 'Glob' has no structured renderer (render-mode.ts), so this stays on the
  // JsonBlock pretty-print path the test targets. Real tool-call args are valid
  // (properly escaped) JSON, so they now pretty-print.
  const html = card({ seq: 1, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_call',
    tool: { name: 'Glob', input: { text: JSON.stringify({ pattern: longPath }) }, toolUseId: 'toolu_x' } });
  assert.ok(html.includes('BUILD-AND-WIRE-OVERVIEW-FACET.md'), 'full filename retained');
  assert.ok(!html.includes('…'), 'no horizontal ellipsis cut');
  assert.ok(html.includes('whitespace-pre-wrap'), 'pretty body carries wrapping classes');
  assert.ok(html.includes('text-foreground font-medium'), 'args rendered as formatted JSON (key span)');
  assert.ok(!html.includes('toolu_x'), 'toolUseId never rendered (AD-6)');
});

// --- P02-T01: structured tool-shape renderer ---

test('a known tool (Read) renders a label/value row instead of the raw JSON block', () => {
  const html = card({ seq: 1, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_call',
    tool: { name: 'Read', input: { text: JSON.stringify({ file_path: 'ui/lib/foo.ts' }) }, toolUseId: 'toolu_x' } });
  assert.ok(html.includes('File') && html.includes('ui/lib/foo.ts'), 'File label/value rendered');
  assert.ok(!html.includes('file_path'), 'raw JSON key not rendered — this is the structured path, not JsonBlock');
  assert.ok(!html.includes('toolu_x'), 'toolUseId never rendered (AD-6)');
});

test('an unknown tool with valid JSON args falls back to JsonBlock, not a blank grid', () => {
  const html = card({ seq: 1, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_call',
    tool: { name: 'Glob', input: { text: JSON.stringify({ pattern: '**/*.ts' }) }, toolUseId: 'toolu_x' } });
  assert.ok(html.includes('pattern') && html.includes('**/*.ts'), 'raw JSON rendered via JsonBlock');
});

test('tool_call falls back to JsonBlock when extractToolFields yields null (source inspection)', () => {
  const bodyMatch = /case "tool_call": \{([\s\S]*?)\n    \}/.exec(src);
  assert.ok(bodyMatch, 'tool_call case body located in source');
  const body = bodyMatch![1];
  assert.match(body, /extractToolFields\(/, 'tool_call case calls extractToolFields');
  assert.match(body, /fields\s*\?/, 'branches on the extractor result');
  assert.match(body, /JsonBlock/, 'JsonBlock remains the else branch');
});

test('non-JSON tool-call args render the raw wrapping fallback span (no pretty-print)', () => {
  const html = card({ seq: 1, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_call',
    tool: { name: 'Grep', input: { text: 'pattern foo' }, toolUseId: 'toolu_x' } });
  assert.ok(html.includes('pattern foo'), 'raw args rendered');
  assert.ok(html.includes('whitespace-pre-wrap') && html.includes('break-all'), 'fallback wrapping classes intact');
});

test('JSON tool-result output pretty-prints instead of the line-number gutter', () => {
  const html = card({ seq: 2, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_result',
    result: { toolUseId: 'x', output: { text: '{"status":"ok","count":3}' }, isError: false } }, { showToolIO: true });
  assert.ok(html.includes('text-foreground font-medium'), 'key span present (pretty JSON)');
  assert.ok(html.includes('status') && html.includes('count'), 'fields rendered');
  assert.ok(!html.includes('>1<'), 'no line-number gutter for JSON output');
});

test('a body over 10 lines renders the more/less reveal control (Issue 2)', () => {
  const long = Array.from({ length: 14 }, (_, i) => `thought line ${i}`).join('\n');
  const html = card({ seq: 2, timestamp: '2026-06-24T09:00:00.000Z', kind: 'thinking', text: long });
  assert.ok(html.includes('data-reveal'), 'reveal wrapper present');
  assert.ok(html.includes('type="checkbox"') && html.includes('peer'), 'css-only peer checkbox present');
  assert.ok(html.includes('more') && html.includes('less'), 'more + less labels present');
  assert.ok(/max-h-/.test(html), 'clamped body carries a max-height');
});

test('a body at or under 10 lines renders no reveal control (Issue 2)', () => {
  const html = card({ seq: 3, timestamp: '2026-06-24T09:00:00.000Z', kind: 'message', role: 'user', text: 'a\nb\nc' });
  assert.ok(!html.includes('data-reveal') && !html.includes('type="checkbox"'), 'no control on a short card');
  assert.ok(html.includes('a') && html.includes('b') && html.includes('c'), 'body still rendered bare');
});

test('a long capped result keeps its truncation badge even with the reveal control (capture-cap honesty)', () => {
  const long = Array.from({ length: 16 }, (_, i) => `out ${i}`).join('\n');
  const html = card({ seq: 4, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_result',
    result: { toolUseId: 'x', output: { text: long, truncated: true, fullBytes: 20480 }, isError: false } }, { showToolIO: true });
  assert.ok(html.includes('data-reveal') && html.includes('type="checkbox"'), 'reveal control on a long result');
  assert.ok(/truncated/i.test(html) && html.includes('20 KB'), 'truncation badge persists alongside the reveal');
});

// --- P02-T02: markdown reuse, per-item Rendered/Raw override, line-number fix, half-clamp ---

test('the card imports and routes through the house MarkdownRenderer rather than re-implementing it', () => {
  assert.match(src, /from ["']@\/components\/documents["']/, 'imports from the documents barrel, not a local re-implementation');
  const messageBody = /case "message": \{([\s\S]*?)\n    \}/.exec(src);
  assert.ok(messageBody, 'message case body located in source');
  assert.match(messageBody![1], /MarkdownRenderer/, 'message case renders via MarkdownRenderer');
  const resultBody = /case "tool_result": \{([\s\S]*?)\n    \}/.exec(src);
  assert.ok(resultBody, 'tool_result case body located in source');
  assert.match(resultBody![1], /MarkdownRenderer/, 'tool_result case renders via MarkdownRenderer');
});

test('a user message renders through MarkdownRenderer by default (document-viewer discipline)', () => {
  const html = card({ seq: 1, timestamp: '2026-07-08T09:00:00.000Z', kind: 'message', role: 'user', text: 'do this' });
  // "prose" is MarkdownRenderer's own wrapper class — its presence signals the
  // card actually mounted the shared component, not merely a source-level import.
  assert.ok(html.includes('prose'), 'markdown prose wrapper present, confirming live routing to MarkdownRenderer');
  assert.ok(html.includes('do this'), 'body text still rendered');
});

test('the item header renders a Rendered/Raw segmented control for message and tool_result kinds, never for structured tool_call', () => {
  const message = card({ seq: 1, timestamp: '2026-07-08T09:00:00.000Z', kind: 'message', role: 'user', text: 'hi' });
  assert.ok(/Rendered/.test(message) && />Raw</.test(message), 'segmented control present on a message card');

  const result = card({ seq: 2, timestamp: '2026-07-08T09:00:00.000Z', kind: 'tool_result',
    result: { toolUseId: 'x', output: { text: 'boom' }, isError: false } }, { showToolIO: true });
  assert.ok(/Rendered/.test(result) && />Raw</.test(result), 'segmented control present on a tool_result card');

  const call = card({ seq: 3, timestamp: '2026-07-08T09:00:00.000Z', kind: 'tool_call',
    tool: { name: 'Bash', input: { text: JSON.stringify({ command: 'ls' }) }, toolUseId: 'a' } });
  assert.ok(!/Rendered/.test(call), 'no segmented control on a structured tool_call card');
});

test('a Read-origin raw result suppresses CodeBlock line numbers so the baked-in cat -n numbers are not doubled', () => {
  const html = card(
    { seq: 1, timestamp: '2026-07-08T09:00:00.000Z', kind: 'tool_result',
      result: { toolUseId: 'x', output: { text: '     1\tfoo\n     2\tbar' }, isError: false } },
    { showToolIO: true, originatingTool: 'ui/lib/foo.ts' },
  );
  assert.ok(html.includes('foo') && html.includes('bar'), 'output text still rendered');
  assert.ok(!/>1</.test(html) && !/>2</.test(html), 'no added line-number gutter column');
});

test('a non-Read raw result still gets an added line-number column (regression)', () => {
  const html = card(
    { seq: 1, timestamp: '2026-07-08T09:00:00.000Z', kind: 'tool_result',
      result: { toolUseId: 'x', output: { text: 'line a\nline b' }, isError: false } },
    { showToolIO: true, originatingTool: 'Bash' },
  );
  assert.ok(html.includes('>1<') && html.includes('>2<'), 'line-number gutter present for non-Read raw output');
});

test('a Read-origin markdown result strips baked-in cat -n prefixes before rendering', () => {
  const html = card(
    { seq: 1, timestamp: '2026-07-08T09:00:00.000Z', kind: 'tool_result',
      result: { toolUseId: 'x', output: { text: '     1\t# Heading\n     2\t\n     3\tSome body text.' }, isError: false } },
    { showToolIO: true, originatingTool: 'docs/notes.md' },
  );
  assert.ok(/<h1[\s>]/.test(html), 'renders a real heading element, not a single collapsed code block');
  assert.ok(html.includes('Heading') && html.includes('Some body text.'), 'body content survives stripping');
  assert.ok(!/\d+\t/.test(html), 'no baked-in line-number prefix survives in output');
});

test('a non-Read markdown result (Agent/Task prose) is not stripped', () => {
  const html = card(
    { seq: 1, timestamp: '2026-07-08T09:00:00.000Z', kind: 'tool_result',
      result: { toolUseId: 'x', output: { text: '# Report\n\nStep 1\tdone.' }, isError: false } },
    { showToolIO: true, originatingTool: 'Agent' },
  );
  assert.ok(/<h1[\s>]/.test(html), 'renders a real heading element');
  assert.ok(html.includes('Step 1') && html.includes('done.'), 'literal tab-containing prose text is preserved verbatim');
});

test('a non-markdown tool_result defaults to the raw JsonBlock/CodeBlock path, not MarkdownRenderer (mode path, not content)', () => {
  const html = card(
    { seq: 1, timestamp: '2026-07-08T09:00:00.000Z', kind: 'tool_result', result: { toolUseId: 'x', output: { text: 'stdout body' }, isError: false } },
    { showToolIO: true, originatingTool: 'Bash' },
  );
  assert.ok(!html.includes('class="prose'), 'markdown prose wrapper not used for the raw-mode default');
});

test('collapsed reveal bodies clamp via an inline CSS variable, not a fixed Tailwind class (half-clamp)', () => {
  const long = Array.from({ length: 20 }, (_, i) => `thought line ${i}`).join('\n');
  const html = card({ seq: 1, timestamp: '2026-07-08T09:00:00.000Z', kind: 'thinking', text: long });
  assert.ok(html.includes('--reveal-clamp'), 'clamp height delivered via a CSS custom property');
  assert.ok(/max-h-/.test(html), 'clamped body still carries a max-height utility');
});
