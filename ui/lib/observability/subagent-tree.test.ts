import assert from 'node:assert/strict';
import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import { buildSubagentTree } from './subagent-tree';

function row(p: Partial<ObservabilityUsageRow>): ObservabilityUsageRow {
  return {
    sessionId: 's1', usageId: Math.random().toString(36).slice(2), timestamp: '2026-06-21T00:00:00.000Z',
    inputTokens: 0, outputTokens: 0, model: 'claude-opus-4-8', source: 'main-agent', ...p,
  };
}

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}

test('partitions main-agent vs subagents and sums windowTotal (FR-4)', () => {
  const tree = buildSubagentTree([
    row({ source: 'main-agent', outputTokens: 100 }),               // 500 eff
    row({ source: 'subagent', agentType: 'coder', agentId: 'a1', outputTokens: 10 }), // 50 eff
  ]);
  assert.equal(tree.main.tokens, 500);
  assert.equal(tree.subagentTotal, 50);
  assert.equal(tree.windowTotal, 550);
  assert.ok(Math.abs(tree.subagentPct - 50 / 550) < 1e-9);
});

test('groups subagents by agentType, expands to agentId runs labelled by first-seen order (FR-3)', () => {
  const tree = buildSubagentTree([
    row({ source: 'subagent', agentType: 'coder', agentId: 'a1', outputTokens: 1 }),
    row({ source: 'subagent', agentType: 'coder', agentId: 'a2', outputTokens: 2 }),
    row({ source: 'subagent', agentType: 'reviewer', agentId: 'b1', outputTokens: 1 }),
  ]);
  const coder = tree.subagents.find((g) => g.label === 'coder')!;
  assert.equal(coder.runCount, 2);
  assert.equal(coder.kind, 'group');
  const labels = (coder.runs ?? []).map((r) => r.label).sort();
  assert.deepEqual(labels, ['coder 1', 'coder 2']);
});

test('orders groups + runs by first activity; numbering follows execution order, not spend (FR-3)', () => {
  const tree = buildSubagentTree([
    // 'reviewer' is active earliest → its group sorts before 'coder'.
    row({ source: 'subagent', agentType: 'reviewer', agentId: 'r1', outputTokens: 1, timestamp: '2026-06-21T00:00:01.000Z' }),
    // coder run c2 spends MORE but starts LATER than c1 → must still number as 'coder 2'.
    row({ source: 'subagent', agentType: 'coder', agentId: 'c2', outputTokens: 100, timestamp: '2026-06-21T00:00:03.000Z' }),
    row({ source: 'subagent', agentType: 'coder', agentId: 'c1', outputTokens: 5, timestamp: '2026-06-21T00:00:02.000Z' }),
  ]);
  // reviewer (t=1) before coder group (earliest run t=2)
  assert.deepEqual(tree.subagents.map((g) => g.label), ['reviewer', 'coder']);
  const coder = tree.subagents.find((g) => g.label === 'coder')!;
  // c1 (earlier, fewer tokens) is 'coder 1'; c2 (later, more tokens) is 'coder 2'.
  assert.deepEqual((coder.runs ?? []).map((r) => ({ key: r.key, label: r.label })), [
    { key: 'c1', label: 'coder 1' },
    { key: 'c2', label: 'coder 2' },
  ]);
});

test('a run with no parseable timestamp sinks to the end of its group (FR-3)', () => {
  const tree = buildSubagentTree([
    row({ source: 'subagent', agentType: 'coder', agentId: 'noTs', outputTokens: 9, timestamp: 'not-a-date' }),
    row({ source: 'subagent', agentType: 'coder', agentId: 'real', outputTokens: 1, timestamp: '2026-06-21T00:00:05.000Z' }),
  ]);
  const coder = tree.subagents.find((g) => g.label === 'coder')!;
  assert.deepEqual((coder.runs ?? []).map((r) => r.key), ['real', 'noTs']);   // dated run first, undated last
});

test('falls back to (unattributed) when agentType missing, (unkeyed) run key is stable', () => {
  const tree = buildSubagentTree([row({ source: 'subagent', outputTokens: 5 })]);
  assert.equal(tree.subagents[0].label, '(unattributed)');
  assert.equal(tree.subagents[0].runCount, 1);
});

test('empty input yields zero windowTotal (FR-4)', () => {
  const tree = buildSubagentTree([]);
  assert.equal(tree.windowTotal, 0);
  assert.equal(tree.subagents.length, 0);
});

test('row-set agnostic: a mixed multi-session set rolls up without error (AD-2)', () => {
  const tree = buildSubagentTree([
    row({ sessionId: 's1', source: 'main-agent', outputTokens: 1 }),
    row({ sessionId: 's2', source: 'subagent', agentType: 'coder', agentId: 'x', outputTokens: 1 }),
  ]);
  assert.equal(tree.windowTotal, 10);
});

test('splits node tokens by model, accumulating per model, sorted desc (NFR-8)', () => {
  const tree = buildSubagentTree([
    row({ source: 'main-agent', model: 'claude-opus-4-8', outputTokens: 100 }),   // 500 eff → opus
    row({ source: 'main-agent', model: 'claude-opus-4-8', outputTokens: 100 }),   // 500 eff → opus = 1000
    row({ source: 'main-agent', model: 'claude-haiku-4-5', outputTokens: 10 }),   // 50 eff  → haiku
  ]);
  assert.deepEqual(tree.main.models, [
    { model: 'opus', tokens: 1000 },
    { model: 'haiku', tokens: 50 },
  ]);
});

import { freezeSubagentOrder } from './subagent-tree';

test('freezeSubagentOrder keeps prior order, appends new groups in spend order (NFR-7)', () => {
  const mk = (key: string, tokens: number) => ({ key, kind: 'group' as const, label: key, agentType: key, runCount: 1, tokens, models: [], reqs: 1, firstMs: 0, lastMs: 1 });
  // Frozen order saw [A, B]; current spend order is [C(new,300), B(200), A(100)].
  const current = [mk('C', 300), mk('B', 200), mk('A', 100)];
  const result = freezeSubagentOrder(current, ['A', 'B']);
  assert.deepEqual(result.map((n) => n.key), ['A', 'B', 'C'], 'A,B hold their frozen order; C appended');
});

test('freezeSubagentOrder with empty frozen list is identity (first turn) (NFR-7)', () => {
  const mk = (key: string, tokens: number) => ({ key, kind: 'group' as const, label: key, agentType: key, runCount: 1, tokens, models: [], reqs: 1, firstMs: 0, lastMs: 1 });
  const current = [mk('B', 200), mk('A', 100)];
  assert.deepEqual(freezeSubagentOrder(current, []).map((n) => n.key), ['B', 'A']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
