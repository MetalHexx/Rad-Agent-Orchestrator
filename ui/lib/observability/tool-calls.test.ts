import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toToolCalls, filterToolCalls, originatingToolByResult, resultToolNameBySeq } from './tool-calls';

const call = (seq: number, name: string, text: string, useId: string) =>
  ({ seq, timestamp: '', kind: 'tool_call', tool: { name, input: { text }, toolUseId: useId } }) as never;
const result = (seq: number, useId: string, output: string, isError: boolean) =>
  ({ seq, timestamp: '', kind: 'tool_result', result: { toolUseId: useId, output: { text: output }, isError } }) as never;

test('toToolCalls pairs each call to its result by toolUseId, in order (AD-2, AD-6)', () => {
  const events = [
    call(1, 'Read', 'a.ts', 'u1'), result(2, 'u1', 'ok', false),
    call(3, 'Bash', 'npm test', 'u2'), result(4, 'u2', 'boom', true),
  ];
  const calls = toToolCalls(events);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'Read');
  assert.equal(calls[0].seq, 1);
  assert.equal(calls[0].isError, false);
  assert.equal(calls[0].resultEvent?.seq, 2);
  assert.equal(calls[1].isError, true);
});

test('a call with no matching result yet is ok with no resultEvent (FR-7)', () => {
  const calls = toToolCalls([call(1, 'Read', 'a.ts', 'u1')]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].isError, false);
  assert.equal(calls[0].resultEvent, undefined);
});

test('toToolCalls agrees with the toolSummary it should mirror (NFR-5)', () => {
  const events = [
    call(1, 'Read', 'a', 'u1'), result(2, 'u1', 'x', false),
    call(3, 'Read', 'b', 'u2'), result(4, 'u2', 'y', false),
    call(5, 'Glob', '*', 'u3'), result(6, 'u3', 'z', true),
  ];
  const calls = toToolCalls(events);
  const byName = calls.reduce<Record<string, number>>((m, c) => { m[c.name] = (m[c.name] ?? 0) + 1; return m; }, {});
  assert.equal(calls.length, 3);                  // == toolSummary.total
  assert.deepEqual(byName, { Read: 2, Glob: 1 });  // == toolSummary.byName
  assert.equal(calls.filter((c) => c.isError).length, 1); // == toolSummary.errors
});

test('originatingToolByResult resolves Read results to the file path they read, others to the bare tool name', () => {
  const events = [
    call(1, 'Read', JSON.stringify({ file_path: 'ui/lib/foo.ts' }), 'u1'), result(2, 'u1', 'ok', false),
    call(3, 'Bash', 'npm test', 'u2'), result(4, 'u2', 'boom', true),
  ];
  const map = originatingToolByResult(events);
  assert.equal(map.get(2), 'ui/lib/foo.ts');
  assert.equal(map.get(4), 'Bash');
});

// Regression (phase review Finding 1): the pairing map MUST be built from the full,
// unfiltered event list. A call can be absent from a narrower/windowed subset (e.g.
// scrolled out of view) while its result remains, so a map built from that subset
// silently loses the entry.
test('originatingToolByResult loses the pairing when built from a subset missing the call, but resolves it when built from the full list', () => {
  const events = [
    call(1, 'Read', JSON.stringify({ file_path: 'ui/lib/foo.ts' }), 'u1'),
    result(2, 'u1', '     1\tfoo', false),
  ];
  const subset = events.slice(1); // simulates the call scrolled out of a windowed view
  assert.equal(subset.length, 1, 'sanity: only the tool_result remains');
  assert.equal(originatingToolByResult(subset).size, 0, 'built from the subset missing the call, the pairing is lost');
  assert.equal(originatingToolByResult(events).get(2), 'ui/lib/foo.ts', 'built from the full list, the pairing resolves');
});

test('resultToolNameBySeq resolves the plain tool name (no Read-to-file-path special-casing), matching Tools ▾ option values', () => {
  const events = [
    call(1, 'Read', JSON.stringify({ file_path: 'ui/lib/foo.ts' }), 'u1'), result(2, 'u1', 'ok', false),
    call(3, 'Bash', 'npm test', 'u2'), result(4, 'u2', 'boom', true),
  ];
  const map = resultToolNameBySeq(events);
  assert.equal(map.get(2), 'Read');
  assert.equal(map.get(4), 'Bash');
});

test('filterToolCalls composes tool, errorsOnly, and query (FR-7)', () => {
  const events = [
    call(1, 'Read', 'alpha.ts', 'u1'), result(2, 'u1', 'x', false),
    call(3, 'Bash', 'npm run beta', 'u2'), result(4, 'u2', 'boom', true),
    call(5, 'Read', 'beta.ts', 'u3'), result(6, 'u3', 'y', false),
  ];
  const calls = toToolCalls(events);
  assert.equal(filterToolCalls(calls, { toolFilter: 'Read', errorsOnly: false, query: '' }).length, 2);
  assert.equal(filterToolCalls(calls, { toolFilter: null, errorsOnly: true, query: '' }).length, 1);
  assert.equal(filterToolCalls(calls, { toolFilter: null, errorsOnly: false, query: 'beta' }).length, 2);
  assert.equal(filterToolCalls(calls, { toolFilter: 'Read', errorsOnly: false, query: 'beta' }).length, 1);
});
