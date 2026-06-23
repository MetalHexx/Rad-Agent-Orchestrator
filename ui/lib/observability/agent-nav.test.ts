import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenAgentTree, siblingNav, availableTranscriptIds } from './agent-nav';
import type { AgentNode } from '@rad-orchestration/telemetry';

const node = (p: Partial<AgentNode>): AgentNode => ({
  transcriptId: 'x', role: 'subagent', model: [], tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
  toolSummary: { total: 0, byName: {}, errors: 0 }, file: 'agent-x.json', children: [], ...p,
});

test('flattenAgentTree yields main first then subagents in tree order (FR-12, FR-14)', () => {
  const tree = [
    node({ transcriptId: 'sess', role: 'main', label: 'main', file: 'main.json' }),
    node({ transcriptId: 'a1', label: 'Coder 1' }),
    node({ transcriptId: 'b1', label: 'Explore 1' }),
  ];
  assert.deepEqual(flattenAgentTree(tree).map((a) => a.transcriptId), ['sess', 'a1', 'b1']);
});

test('siblingNav returns neighbor ids, clamped at the ends (FR-15)', () => {
  const list = [{ transcriptId: 'sess' }, { transcriptId: 'a1' }, { transcriptId: 'b1' }] as never;
  assert.deepEqual(siblingNav(list, 'a1'), { prevId: 'sess', nextId: 'b1' });
  assert.deepEqual(siblingNav(list, 'sess'), { prevId: null, nextId: 'a1' });
  assert.deepEqual(siblingNav(list, 'b1'), { prevId: 'a1', nextId: null });
});

test('availableTranscriptIds collects every transcriptId in the tree (FR-12)', () => {
  const ids = availableTranscriptIds([
    node({ transcriptId: 'sess', role: 'main', children: [node({ transcriptId: 'a1' })] }),
  ]);
  assert.ok(ids.has('sess') && ids.has('a1'));
});
