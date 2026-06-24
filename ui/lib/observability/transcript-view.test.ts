import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, toolArgPreview } from './transcript-view';
import { visibleEvents, errorEventSeqs, isTightResult, windowEvents } from './transcript-view';

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
