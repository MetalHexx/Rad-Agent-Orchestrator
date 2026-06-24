import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentTree } from './agent-tree';
import type { SubagentTree } from '@/lib/observability/subagent-tree';
Object.assign(globalThis, { React });

const tree: SubagentTree = {
  windowTotal: 100, subagentTotal: 40, subagentPct: 0.4,
  main: { key: 'main', kind: 'main', label: 'main-agent', runCount: 1, tokens: 60, models: [{ model: 'opus', tokens: 60 }], reqs: 1, firstMs: 0, lastMs: 1 },
  subagents: [{ key: 'run-bb', kind: 'group', label: 'Explore', agentType: 'Explore', runCount: 1, tokens: 40, models: [{ model: 'haiku', tokens: 40 }], reqs: 1, firstMs: 0, lastMs: 1, runs: [{ key: 'run-bb', kind: 'run', label: 'Explore 1', agentType: 'Explore', runCount: 1, tokens: 40, models: [], reqs: 1, firstMs: 0, lastMs: 1 }] }],
};
// main (sessionId 'sess-1') AND the single-run leaf (runId 'run-bb') both have transcripts.
// The leaf row is rendered from leafFrom(group) whose key is the agentType ('Explore'), NOT
// the runId — so the wiring MUST resolve the leaf from the group node to reach 'run-bb'. If it
// resolves to 'Explore', the leaf is wrongly gated off and this asserts 1 instead of 2 (FR-5, AD-6).
const html = renderToStaticMarkup(createElement(AgentTree, {
  tree, ready: true, now: 1000, sessionId: 'sess-1', availableIds: new Set(['sess-1', 'run-bb']), onInspect: () => {},
}));
assert.ok(/aria-label="Inspect agent"/.test(html), 'shows the inspect affordance on available rows (FR-3)');
assert.ok(!html.includes('TELEMETRY-8'), 'old disabled placeholder seam links are gone (FR-3)');
const enabled = (html.match(/aria-label="Inspect agent"/g) ?? []).length;
assert.equal(enabled, 2, 'both the main row and the single-run leaf resolve to a real transcriptId and are inspectable — the leaf is resolved to its runId, not its agentType (FR-4, FR-5, AD-6)');
console.log('✓ agent tree: gated inspect affordance, leaf resolves to runId');
