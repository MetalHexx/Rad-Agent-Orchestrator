import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toToolCalls, filterToolCalls, originatingToolByResult } from './tool-calls';
import { applyFacets, type TranscriptFacetState } from './transcript-view';

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
// unfiltered event list. A facet can hide a tool_call while its tool_result stays
// visible (tools facet governs tool_call visibility; the separate toolResults facet
// governs tool_result visibility — see transcript-view.ts's matchesFacet), so a map
// built from a facet-filtered subset silently loses the entry.
test('originatingToolByResult loses the pairing when built from a facet-filtered subset, but resolves it when built from the unfiltered list', () => {
  const events = [
    call(1, 'Read', JSON.stringify({ file_path: 'ui/lib/foo.ts' }), 'u1'),
    result(2, 'u1', '     1\tfoo', false),
  ];
  const facets: TranscriptFacetState = {
    types: { user: true, assistant: true, thinking: true, toolResults: true, errors: true },
    tools: new Set(['Bash']), // Read deselected
    files: 'all',
    query: '',
  };
  const filtered = applyFacets(events, facets);
  assert.deepEqual(filtered.map((e) => e.kind), ['tool_result'], 'the Read tool_call is filtered out; its result survives');
  assert.equal(originatingToolByResult(filtered).size, 0, 'built from the filtered subset, the pairing is lost');
  assert.equal(originatingToolByResult(events).get(2), 'ui/lib/foo.ts', 'built from the unfiltered list, the pairing resolves');
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
