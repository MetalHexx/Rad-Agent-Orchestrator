import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, toolArgPreview } from './transcript-view';
import { errorEventSeqs, isTightResult, windowEvents } from './transcript-view';
import { CLAMP_LINES, displayLineCount, needsClamp, collapsedClampEm, MIN_CLAMP_EM, MAX_CLAMP_EM } from './transcript-view';
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

test('toolArgPreview with max=Infinity returns the full first line uncapped (P04-T02)', () => {
  // long single-line input returns the full first line, not sliced
  const longInput = 'x'.repeat(200);
  assert.equal(toolArgPreview(longInput, Infinity), longInput);

  // still takes first line only when multiline
  assert.equal(toolArgPreview('  long line with spaces  \nsecond line', Infinity), 'long line with spaces');

  // still trims whitespace
  assert.equal(toolArgPreview('  ls -la  ', Infinity), 'ls -la');

  // handles undefined
  assert.equal(toolArgPreview(undefined, Infinity), '');

  // default max=80 still slices
  assert.ok(toolArgPreview('x'.repeat(200)).length <= 80);
});

const E = (over: Record<string, unknown>) => ({ seq: 0, timestamp: '', ...over }) as never;

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
  types: { user: true, assistant: true, thinking: true, errors: true },
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
    seqs({ ...allFacets(), types: { ...allFacets().types, errors: false } }),
    [1, 2, 3, 4, 5, 6, 8, 9, 10, 11]
  );
});

test('applyFacets: system and hook kinds are always visible regardless of type toggles', () => {
  const f: TranscriptFacetState = {
    types: { user: false, assistant: false, thinking: false, errors: false },
    tools: new Set<string>(),
    files: new Set<string>(),
    query: '',
  };
  assert.deepEqual(applyFacets(facetEvents, f).map((e) => e.seq), [10, 11]);
});

test('applyFacets: a tool subset shows only that tool\'s calls AND results (no separate Tool results toggle); an empty tool set hides both', () => {
  const subset = applyFacets(facetEvents, { ...allFacets(), tools: new Set(['Bash']) });
  assert.deepEqual(subset.filter((e) => e.kind === 'tool_call').map((e) => e.seq), [4]);
  // seq 6 is Bash's own (non-error) result and survives; seq 7 is Read's
  // (error) result and is hidden by tool selection even though errors is on.
  assert.deepEqual(subset.filter((e) => e.kind === 'tool_result').map((e) => e.seq), [6]);

  const none = applyFacets(facetEvents, { ...allFacets(), tools: new Set<string>() });
  assert.deepEqual(none.filter((e) => e.kind === 'tool_call'), []);
  assert.deepEqual(none.filter((e) => e.kind === 'tool_result'), []);
});

test('applyFacets: a file-op subset filters file_change', () => {
  const editOnly = applyFacets(facetEvents, { ...allFacets(), files: new Set(['edit']) });
  assert.deepEqual(editOnly.filter((e) => e.kind === 'file_change').map((e) => e.seq), [8]);

  const none = applyFacets(facetEvents, { ...allFacets(), files: new Set<string>() });
  assert.deepEqual(none.filter((e) => e.kind === 'file_change'), []);
});

test('applyFacets: the errors toggle only ever hides error results, and composes with the tool-name gate', () => {
  // errors off, all tools selected: only the non-error result (seq 6) survives.
  const noErrors = applyFacets(facetEvents, { ...allFacets(), types: { ...allFacets().types, errors: false } });
  assert.deepEqual(noErrors.filter((e) => e.kind === 'tool_result').map((e) => e.seq), [6]);

  // errors on, but only Bash selected: Read's error result (seq 7) is hidden
  // by tool selection, not by the errors toggle — the two gates are independent.
  const bashOnly = applyFacets(facetEvents, { ...allFacets(), tools: new Set(['Bash']) });
  assert.deepEqual(bashOnly.filter((e) => e.kind === 'tool_result').map((e) => e.seq), [6]);

  // errors on, only Read selected: Read's error result survives.
  const readOnly = applyFacets(facetEvents, { ...allFacets(), tools: new Set(['Read']) });
  assert.deepEqual(readOnly.filter((e) => e.kind === 'tool_result').map((e) => e.seq), [7]);
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

test('collapsedClampEm returns 0 for empty text', () => {
  assert.equal(collapsedClampEm('', 80), 0);
});

test('collapsedClampEm returns a sixth of the rendered line count, rounded up', () => {
  const oddLines = Array.from({ length: 21 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(displayLineCount(oddLines, 80), 21);
  assert.equal(collapsedClampEm(oddLines, 80), 4); // ceil(21 / 6)

  const evenLines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(collapsedClampEm(evenLines, 80), 4); // ceil(20 / 6)

  // a single 1000-char line wraps to 13 rows at 80 cols → ceil(13 / 6) is 3
  assert.equal(collapsedClampEm('x'.repeat(1000), 80), 3);
});

test('collapsedClampEm floors short bodies at a minimum sane height rather than a sliver', () => {
  assert.equal(collapsedClampEm('one line', 80), MIN_CLAMP_EM);
  assert.equal(collapsedClampEm('a\nb', 80), MIN_CLAMP_EM);
});

test('collapsedClampEm ceilings huge or truncated bodies instead of a proportionally-large-but-still-huge preview', () => {
  const hugeBody = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(displayLineCount(hugeBody, 80), 200);
  assert.ok(Math.ceil(200 / 6) > MAX_CLAMP_EM, 'sanity: the uncapped sixth would exceed the ceiling');
  assert.equal(collapsedClampEm(hugeBody, 80), MAX_CLAMP_EM);
});
