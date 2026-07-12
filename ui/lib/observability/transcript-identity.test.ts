import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowTranscriptId, isInspectable, numberedAgentLabels } from './transcript-identity';
import type { AgentTreeNode, SubagentTree } from './subagent-tree';

const tn = (p: Partial<AgentTreeNode>): AgentTreeNode => ({
  key: 'k', kind: 'run', label: 'l', runCount: 1, tokens: 0, models: [], reqs: 0, firstMs: 0, lastMs: 0,
  newTokens: 0, dollars: 0, ...p,
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

test('numberedAgentLabels: main→Main Agent, multi-run→numbered by runId, single-run→agentType (FR-5)', () => {
  const tree: SubagentTree = {
    windowTotal: 0, subagentTotal: 0, subagentPct: 0,
    main: tn({ key: 'main', kind: 'main', label: 'main-agent' }),
    subagents: [
      tn({ key: 'coder', kind: 'group', label: 'coder', runCount: 2, runs: [
        tn({ key: 'c1', kind: 'run', label: 'coder 1' }),
        tn({ key: 'c2', kind: 'run', label: 'coder 2' }),
      ] }),
      tn({ key: 'reviewer', kind: 'group', label: 'reviewer', runCount: 1, runs: [
        tn({ key: 'r1', kind: 'run', label: 'reviewer 1' }),
      ] }),
    ],
  };
  const m = numberedAgentLabels(tree, 'sess-1');
  assert.equal(m.get('sess-1'), 'Main Agent');     // keyed by sessionId, never the raw id
  assert.equal(m.get('c1'), 'coder 1');            // multi-run → per-run numbered label, keyed by runId
  assert.equal(m.get('c2'), 'coder 2');
  assert.equal(m.get('r1'), 'reviewer');           // single-run leaf → unnumbered agentType label
});
