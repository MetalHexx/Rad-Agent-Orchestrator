import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentTree } from './agent-tree';
import type { SubagentTree } from '@/lib/observability/subagent-tree';
Object.assign(globalThis, { React });

const tree: SubagentTree = {
  windowTotal: 100, subagentTotal: 40, subagentPct: 0.4,
  main: { key: 'main', kind: 'main', label: 'main-agent', tokens: 60, models: [{ model: 'opus', tokens: 60, dollars: 0.6 }], reqs: 1, firstMs: 0, lastMs: 1, newTokens: 10, dollars: 0.6 },
  subagents: [{ key: 'run-bb', kind: 'run', label: 'Explore', agentType: 'Explore', tokens: 40, models: [{ model: 'haiku', tokens: 40, dollars: 0.4 }], reqs: 1, firstMs: 0, lastMs: 1, newTokens: 5, dollars: 0.4 }],
};
// main (sessionId 'sess-1') AND the one flat subagent run (runId 'run-bb') both have transcripts.
// No leafFrom indirection anymore — the flat subagent row resolves its transcript id straight from
// node.key ('run-bb'), so both rows become whole-row inspect click targets (FR-4, FR-5).
const html = renderToStaticMarkup(createElement(AgentTree, {
  tree, ready: true, now: 1000, sessionId: 'sess-1', onInspect: () => {},
}));
assert.ok(/aria-label="Inspect /.test(html), 'shows the whole-row inspect overlay on inspectable rows (FR-3)');
assert.ok(!html.includes('TELEMETRY-8'), 'old disabled placeholder seam links are gone (FR-3)');
const enabled = (html.match(/aria-label="Inspect /g) ?? []).length;
assert.equal(enabled, 2, 'both the main row and the one flat subagent run resolve to a real transcriptId and render the whole-row overlay (FR-4, FR-5)');
console.log('✓ agent tree: whole-row inspect overlay, flat subagent resolves to runId');
