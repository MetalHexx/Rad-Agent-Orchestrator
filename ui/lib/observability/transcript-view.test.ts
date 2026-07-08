import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, toolArgPreview } from './transcript-view';
import { visibleEvents, errorEventSeqs, isTightResult, windowEvents } from './transcript-view';
import { CLAMP_LINES, displayLineCount, needsClamp } from './transcript-view';
import { applyFacets, facetLabel } from './transcript-view';
import type { TranscriptFacetState } from './transcript-view';

test('formatClock extracts HH:MM:SS from an ISO timestamp, SSR-safe (DD-3)', () => {
  assert.equal(formatClock('2026-06-24T13:05:09.123Z'), '13:05:09');
  assert.equal(formatClock('not-a-date'), '');
});

test('toolArgPreview takes the first line, trimmed and capped (DD-4)', () => {
  assert.equal(toolArgPreview('  ls -la  \nsecond line'), 'ls -la');
  assert.equal(toolArgPreview(undefined), '');
  assert.ok(toolArgPreview('x'.repeat(200)).length <= 80);
});

const E = (over: Record<string, unknown>) => ({ seq: 0, timestamp: '', ...over }) as never;

test('visibleEvents hides thinking when off and filters by query (FR-7, FR-9, DD-8)', () => {
  const events = [
    E({ seq: 1, kind: 'thinking', text: 'secret plan' }),
    E({ seq: 2, kind: 'message', role: 'user', text: 'run the build' }),
    E({ seq: 3, kind: 'tool_call', tool: { name: 'Bash', input: { text: 'npm run build' }, toolUseId: 'a' } }),
  ];
  assert.equal(visibleEvents(events, { showThinking: false, query: '' }).length, 2);
  assert.equal(visibleEvents(events, { showThinking: true, query: 'build' }).length, 2);
  assert.equal(visibleEvents(events, { showThinking: true, query: 'nomatch' }).length, 0);
});

test('errorEventSeqs returns only error tool_results, in order (FR-10)', () => {
  const events = [
    E({ seq: 1, kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'ok' }, isError: false } }),
    E({ seq: 2, kind: 'tool_result', result: { toolUseId: 'b', output: { text: 'bad' }, isError: true } }),
    E({ seq: 5, kind: 'tool_result', result: { toolUseId: 'c', output: { text: 'bad2' }, isError: true } }),
  ];
  assert.deepEqual(errorEventSeqs(events), [2, 5]);
});

test('isTightResult is true only for a result adjacent to its own call (FR-4, AD-6, DD-7)', () => {
  const events = [
    E({ seq: 1, kind: 'tool_call', tool: { name: 'Read', input: { text: 'x' }, toolUseId: 'a' } }),
    E({ seq: 2, kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'y' }, isError: false } }),
    E({ seq: 3, kind: 'tool_result', result: { toolUseId: 'z', output: { text: 'orphan' }, isError: false } }),
  ];
  assert.equal(isTightResult(events, 1), true);
  assert.equal(isTightResult(events, 2), false);
});

test('windowEvents bounds the slice and reports the hidden remainder (NFR-1, AD-2)', () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(windowEvents(items, 4), { shown: [6, 7, 8, 9], hidden: 6 });
  assert.equal(windowEvents(items, Infinity).hidden, 0);
});

test('displayLineCount counts explicit newlines AND wrapped rows (per-card reveal)', () => {
  assert.equal(displayLineCount('', 80), 0);
  assert.equal(displayLineCount('one line', 80), 1);
  assert.equal(displayLineCount('a\nb\nc', 80), 3);
  // a single 1000-char line wraps to ceil(1000/80)=13 rows
  assert.equal(displayLineCount('x'.repeat(1000), 80), 13);
  // mixed: a 200-char line (3 rows at 80) plus two short lines = 5
  assert.equal(displayLineCount('y'.repeat(200) + '\nshort\nalso', 80), 5);
});

const allFacets = (): TranscriptFacetState => ({
  types: { user: true, assistant: true, thinking: true, toolResults: true, errors: true },
  tools: 'all',
  files: 'all',
  query: '',
});

const facetEvents = [
  E({ seq: 1, kind: 'message', role: 'user', text: 'run the build' }),
  E({ seq: 2, kind: 'message', role: 'assistant', text: 'ok, running it' }),
  E({ seq: 3, kind: 'thinking', text: 'secret plan' }),
  E({ seq: 4, kind: 'tool_call', tool: { name: 'Bash', input: { text: 'npm run build' }, toolUseId: 'a' } }),
  E({ seq: 5, kind: 'tool_call', tool: { name: 'Read', input: { text: 'file.ts' }, toolUseId: 'b' } }),
  E({ seq: 6, kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'built' }, isError: false } }),
  E({ seq: 7, kind: 'tool_result', result: { toolUseId: 'b', output: { text: 'boom' }, isError: true } }),
  E({ seq: 8, kind: 'file_change', file: { path: 'a.ts', op: 'edit' } }),
  E({ seq: 9, kind: 'file_change', file: { path: 'b.ts', op: 'write' } }),
  E({ seq: 10, kind: 'system', text: 'session start' }),
  E({ seq: 11, kind: 'hook', text: 'PostToolUse' }),
];

test('applyFacets: each type toggle hides only its kind', () => {
  const seqs = (f: TranscriptFacetState) => applyFacets(facetEvents, f).map((e) => e.seq);

  assert.deepEqual(
    seqs({ ...allFacets(), types: { ...allFacets().types, user: false } }),
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  );
  assert.deepEqual(
    seqs({ ...allFacets(), types: { ...allFacets().types, assistant: false } }),
    [1, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  );
  assert.deepEqual(
    seqs({ ...allFacets(), types: { ...allFacets().types, thinking: false } }),
    [1, 2, 4, 5, 6, 7, 8, 9, 10, 11]
  );
  assert.deepEqual(
    seqs({ ...allFacets(), types: { ...allFacets().types, toolResults: false } }),
    [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]
  );
  assert.deepEqual(
    seqs({ ...allFacets(), types: { ...allFacets().types, errors: false } }),
    [1, 2, 3, 4, 5, 6, 8, 9, 10, 11]
  );
});

test('applyFacets: system and hook kinds are always visible regardless of type toggles', () => {
  const f: TranscriptFacetState = {
    types: { user: false, assistant: false, thinking: false, toolResults: false, errors: false },
    tools: new Set<string>(),
    files: new Set<string>(),
    query: '',
  };
  assert.deepEqual(applyFacets(facetEvents, f).map((e) => e.seq), [10, 11]);
});

test('applyFacets: a tool subset shows only those tools; an empty tool set hides all tool calls', () => {
  const subset = applyFacets(facetEvents, { ...allFacets(), tools: new Set(['Bash']) });
  assert.deepEqual(subset.filter((e) => e.kind === 'tool_call').map((e) => e.seq), [4]);

  const none = applyFacets(facetEvents, { ...allFacets(), tools: new Set<string>() });
  assert.deepEqual(none.filter((e) => e.kind === 'tool_call'), []);
});

test('applyFacets: a file-op subset filters file_change', () => {
  const editOnly = applyFacets(facetEvents, { ...allFacets(), files: new Set(['edit']) });
  assert.deepEqual(editOnly.filter((e) => e.kind === 'file_change').map((e) => e.seq), [8]);

  const none = applyFacets(facetEvents, { ...allFacets(), files: new Set<string>() });
  assert.deepEqual(none.filter((e) => e.kind === 'file_change'), []);
});

test('applyFacets: tool_result splits by isError between errors and toolResults', () => {
  const errorsOnly = applyFacets(facetEvents, { ...allFacets(), types: { ...allFacets().types, toolResults: false } });
  assert.deepEqual(errorsOnly.filter((e) => e.kind === 'tool_result').map((e) => e.seq), [7]);

  const resultsOnly = applyFacets(facetEvents, { ...allFacets(), types: { ...allFacets().types, errors: false } });
  assert.deepEqual(resultsOnly.filter((e) => e.kind === 'tool_result').map((e) => e.seq), [6]);
});

test('applyFacets composes with query: a hidden type stays hidden regardless of match', () => {
  const f: TranscriptFacetState = { ...allFacets(), types: { ...allFacets().types, user: false }, query: 'build' };
  const seqs = applyFacets(facetEvents, f).map((e) => e.seq);
  assert.ok(!seqs.includes(1), 'user message stays hidden even though it matches the query');
  assert.deepEqual(seqs, [4]);
});

test('facetLabel returns All, None, or N of M at the boundaries', () => {
  assert.equal(facetLabel('all', 5), 'All');
  assert.equal(facetLabel(new Set(['a', 'b', 'c']), 3), 'All');
  assert.equal(facetLabel(new Set<string>(), 3), 'None');
  assert.equal(facetLabel(new Set(['a']), 3), '1 of 3');
});

test('needsClamp is true only past the 10-line window (per-card reveal)', () => {
  assert.equal(CLAMP_LINES, 10);
  // 12 explicit lines → clamp
  assert.equal(needsClamp(Array.from({ length: 12 }, () => 'l').join('\n'), 88), true);
  // 3 short lines → no clamp
  assert.equal(needsClamp('a\nb\nc', 88), false);
  // one ~1000-char single line wraps past 10 rows → clamp (the args-wrapping path)
  assert.equal(needsClamp('z'.repeat(1000), 88), true);
  // empty → no clamp
  assert.equal(needsClamp('', 88), false);
});
