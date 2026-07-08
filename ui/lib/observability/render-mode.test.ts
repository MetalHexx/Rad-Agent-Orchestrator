import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderModeFor, extractToolFields } from './render-mode';

const event = (over: Record<string, unknown>) =>
  ({ seq: 1, timestamp: '', ...over }) as never;

// --- renderModeFor ---------------------------------------------------------

test('tool_call is always structured, regardless of originating tool', () => {
  assert.equal(renderModeFor(event({ kind: 'tool_call', tool: { name: 'Bash', input: { text: '' }, toolUseId: 'a' } })), 'structured');
});

test('message is always markdown, for both user and assistant', () => {
  assert.equal(renderModeFor(event({ kind: 'message', role: 'assistant', text: 'hi' })), 'markdown');
  assert.equal(renderModeFor(event({ kind: 'message', role: 'user', text: 'hi' })), 'markdown');
});

test('thinking is always raw', () => {
  assert.equal(renderModeFor(event({ kind: 'thinking', text: 'pondering' })), 'raw');
});

test('tool_result from Agent or Task renders markdown (subagent prose)', () => {
  const ev = event({ kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'ok' }, isError: false } });
  assert.equal(renderModeFor(ev, 'Agent'), 'markdown');
  assert.equal(renderModeFor(ev, 'Task'), 'markdown');
});

test('tool_result from a Read of a *.md path renders markdown', () => {
  const ev = event({ kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'ok' }, isError: false } });
  assert.equal(renderModeFor(ev, 'docs/notes.md'), 'markdown');
});

test('tool_result from a Read of a source file renders raw', () => {
  const ev = event({ kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'ok' }, isError: false } });
  assert.equal(renderModeFor(ev, 'ui/lib/foo.ts'), 'raw');
});

test('tool_result from Bash stdout renders raw', () => {
  const ev = event({ kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'ok' }, isError: false } });
  assert.equal(renderModeFor(ev, 'Bash'), 'raw');
});

test('tool_result with no resolvable originating tool defaults to raw', () => {
  const ev = event({ kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'ok' }, isError: false } });
  assert.equal(renderModeFor(ev), 'raw');
});

test('an unmodeled kind falls back to raw (never dropped, never mis-rendered as markdown)', () => {
  assert.equal(renderModeFor(event({ kind: 'system', text: 'boot' })), 'raw');
});

// --- extractToolFields ------------------------------------------------------

test('Read extracts the File field', () => {
  const fields = extractToolFields('Read', JSON.stringify({ file_path: 'ui/lib/foo.ts' }));
  assert.deepEqual(fields, [{ label: 'File', value: 'ui/lib/foo.ts', mono: true }]);
});

test('Write extracts the File field', () => {
  const fields = extractToolFields('Write', JSON.stringify({ file_path: 'ui/lib/foo.ts', content: 'export {}' }));
  assert.deepEqual(fields, [{ label: 'File', value: 'ui/lib/foo.ts', mono: true }]);
});

test('Edit extracts File and a Change preview of old -> new', () => {
  const fields = extractToolFields('Edit', JSON.stringify({
    file_path: 'ui/lib/foo.ts', old_string: 'const x = 1;', new_string: 'const x = 2;',
  }));
  assert.equal(fields?.length, 2);
  assert.deepEqual(fields?.[0], { label: 'File', value: 'ui/lib/foo.ts', mono: true });
  assert.equal(fields?.[1].label, 'Change');
  assert.ok(fields?.[1].value.includes('const x = 1;') && fields[1].value.includes('const x = 2;'));
});

test('Bash extracts Command, and Description only when present', () => {
  const withDesc = extractToolFields('Bash', JSON.stringify({ command: 'npm test', description: 'run the suite' }));
  assert.deepEqual(withDesc, [
    { label: 'Command', value: 'npm test', mono: true },
    { label: 'Description', value: 'run the suite', mono: undefined },
  ]);
  const withoutDesc = extractToolFields('Bash', JSON.stringify({ command: 'npm test' }));
  assert.deepEqual(withoutDesc, [{ label: 'Command', value: 'npm test', mono: true }]);
});

test('Agent extracts Subagent, Description, and Prompt', () => {
  const fields = extractToolFields('Agent', JSON.stringify({
    subagent_type: 'coder', description: 'implement the fix', prompt: 'Do the thing.',
  }));
  assert.deepEqual(fields, [
    { label: 'Subagent', value: 'coder', mono: undefined },
    { label: 'Description', value: 'implement the fix', mono: undefined },
    { label: 'Prompt', value: 'Do the thing.', mono: undefined },
  ]);
});

test('SendMessage extracts To and Summary', () => {
  const fields = extractToolFields('SendMessage', JSON.stringify({ to: 'reviewer', summary: 'ready for review' }));
  assert.deepEqual(fields, [
    { label: 'To', value: 'reviewer', mono: undefined },
    { label: 'Summary', value: 'ready for review', mono: undefined },
  ]);
});

test('Skill extracts the Skill field', () => {
  const fields = extractToolFields('Skill', JSON.stringify({ skill: 'rad-execute-coding-task' }));
  assert.deepEqual(fields, [{ label: 'Skill', value: 'rad-execute-coding-task', mono: undefined }]);
});

test('ToolSearch extracts Query and Max results', () => {
  const fields = extractToolFields('ToolSearch', JSON.stringify({ query: 'auth flow', max_results: 5 }));
  assert.deepEqual(fields, [
    { label: 'Query', value: 'auth flow', mono: true },
    { label: 'Max results', value: '5', mono: undefined },
  ]);
});

test('an unknown tool returns null so the card falls back to JsonBlock', () => {
  assert.equal(extractToolFields('Glob', JSON.stringify({ pattern: '**/*.ts' })), null);
});

test('malformed JSON returns null', () => {
  assert.equal(extractToolFields('Read', '{not valid json'), null);
});

test('a known tool with none of its fields present returns null rather than a blank grid', () => {
  assert.equal(extractToolFields('Read', JSON.stringify({ offset: 10 })), null);
});
