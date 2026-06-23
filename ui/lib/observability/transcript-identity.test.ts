import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowTranscriptId, isInspectable } from './transcript-identity';
import type { AgentTreeNode } from './subagent-tree';

const tn = (p: Partial<AgentTreeNode>): AgentTreeNode => ({
  key: 'k', kind: 'run', label: 'l', runCount: 1, tokens: 0, models: [], reqs: 0, firstMs: 0, lastMs: 0, ...p,
});

test('main resolves to the session id (FR-5)', () => {
  assert.equal(rowTranscriptId(tn({ key: 'main', kind: 'main' }), 'main', 'sess-1'), 'sess-1');
});
test('a run row resolves to its run id (FR-5)', () => {
  assert.equal(rowTranscriptId(tn({ key: 'agentid-aa', kind: 'run' }), 'run', 'sess-1'), 'agentid-aa');
});
test('a single-run leaf resolves to the underlying run id, not the agent-type key (FR-5, AD-6)', () => {
  const group = tn({ key: 'Explore', kind: 'group', runCount: 1, runs: [tn({ key: 'run-bb', kind: 'run', label: 'Explore 1' })] });
  assert.equal(rowTranscriptId(group, 'leaf', 'sess-1'), 'run-bb');
});
test('availability is gated on the session transcript id set (FR-4)', () => {
  const ids = new Set(['sess-1', 'run-bb']);
  assert.equal(isInspectable('run-bb', ids), true);
  assert.equal(isInspectable('missing', ids), false);
});
