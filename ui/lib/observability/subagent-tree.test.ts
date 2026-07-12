import assert from 'node:assert/strict';
import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import { buildSubagentTree } from './subagent-tree';

function row(p: Partial<ObservabilityUsageRow>): ObservabilityUsageRow {
  return {
    sessionId: 's1', usageId: Math.random().toString(36).slice(2), timestamp: '2026-06-21T00:00:00.000Z',
    inputTokens: 0, outputTokens: 0, model: 'claude-opus-4-8', source: 'main-agent', harness: 'claude-code', ...p,
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

test('mixed-type runs interleave in one flat list purely by firstMs, labelled by bare type (FR-3)', () => {
  const tree = buildSubagentTree([
    // Input order is deliberately NOT chronological, and spend is inverted vs. timestamp order,
    // so a pass would only happen via a real sort by firstMs — not insertion order, not spend.
    row({ source: 'subagent', agentType: 'coder', agentId: 'c2', outputTokens: 100, timestamp: '2026-06-21T00:00:03.000Z' }),
    row({ source: 'subagent', agentType: 'coder', agentId: 'c1', outputTokens: 1, timestamp: '2026-06-21T00:00:01.000Z' }),
    row({ source: 'subagent', agentType: 'reviewer', agentId: 'r1', outputTokens: 50, timestamp: '2026-06-21T00:00:02.000Z' }),
  ]);
  assert.deepEqual(tree.subagents.map((n) => ({ key: n.key, label: n.label, kind: n.kind })), [
    { key: 'c1', label: 'coder', kind: 'run' },
    { key: 'r1', label: 'reviewer', kind: 'run' },
    { key: 'c2', label: 'coder', kind: 'run' },
  ]);
});

test('a run with no parseable timestamp sinks to the end of the whole list, not just its type (FR-3)', () => {
  const tree = buildSubagentTree([
    row({ source: 'subagent', agentType: 'coder', agentId: 'noTs', outputTokens: 9, timestamp: 'not-a-date' }),
    row({ source: 'subagent', agentType: 'reviewer', agentId: 'real', outputTokens: 1, timestamp: '2026-06-21T00:00:05.000Z' }),
  ]);
  assert.deepEqual(tree.subagents.map((n) => n.key), ['real', 'noTs']);   // dated run first, undated last regardless of type
});

test('(unattributed) rows of the same type merge; rows with a genuinely different type do not (FR-3)', () => {
  const tree = buildSubagentTree([
    row({ source: 'subagent', outputTokens: 5 }),   // no agentType, no agentId → (unattributed)::(unkeyed)
    row({ source: 'subagent', outputTokens: 3 }),   // same fallback bucket → merges
    row({ source: 'subagent', agentType: 'coder', outputTokens: 1 }),   // real type, no agentId → distinct bucket
  ]);
  assert.equal(tree.subagents.length, 2);
  const unattributed = tree.subagents.find((n) => n.label === '(unattributed)')!;
  assert.equal(unattributed.tokens, 40);   // 5*5 + 3*5 effective tokens merged
  const coder = tree.subagents.find((n) => n.label === 'coder')!;
  assert.equal(coder.tokens, 5);
  assert.notEqual(unattributed.key, coder.key);
});

test('(unkeyed) run key is stable and scoped to its type', () => {
  const tree = buildSubagentTree([
    row({ source: 'subagent', agentType: 'coder', outputTokens: 5 }),
  ]);
  assert.equal(tree.subagents[0].label, 'coder');
  assert.equal(tree.subagents[0].key, 'coder#unkeyed-0');
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
  assert.deepEqual(tree.main.models.map(({ model, tokens }) => ({ model, tokens })), [
    { model: 'opus', tokens: 1000 },
    { model: 'haiku', tokens: 50 },
  ]);
});

test('accumulates newTokens (Σ cacheCreationTokens) on the flat nodes', () => {
  const tree = buildSubagentTree([
    row({ source: 'main-agent', cacheCreationTokens: 40 }),
    row({ source: 'main-agent', cacheCreationTokens: 10 }),
    row({ source: 'subagent', agentType: 'coder', agentId: 'a1', cacheCreationTokens: 5 }),
  ]);
  assert.equal(tree.main.newTokens, 50);
  assert.equal(tree.subagents[0].newTokens, 5);
});

test('attributes dollars per model and sums to the flat node total (per-model dollar split)', () => {
  const tree = buildSubagentTree([
    row({ source: 'main-agent', model: 'claude-opus-4-8', outputTokens: 100 }),
    row({ source: 'main-agent', model: 'claude-opus-4-8', outputTokens: 100 }),
    row({ source: 'main-agent', model: 'claude-haiku-4-5', outputTokens: 10 }),
  ]);
  const opus = tree.main.models.find((m) => m.model === 'opus')!;
  const haiku = tree.main.models.find((m) => m.model === 'haiku')!;
  assert.ok(opus.dollars !== null && haiku.dollars !== null, 'both known-priced models attribute a dollar figure');
  assert.ok(opus.dollars! > haiku.dollars!, 'opus (pricier + more tokens) attributes more dollars than haiku');
  assert.ok(Math.abs(tree.main.dollars! - (opus.dollars! + haiku.dollars!)) < 1e-9, 'node dollars sums the per-model dollars');
});

test('an unknown-priced model makes the flat node dollars null, never a silent $0 (Done when)', () => {
  const tree = buildSubagentTree([
    row({ source: 'main-agent', model: 'claude-opus-4-8', outputTokens: 10 }),
    row({ source: 'main-agent', model: 'some-mystery-model', outputTokens: 10 }),
  ]);
  assert.equal(tree.main.dollars, null);
  const mystery = tree.main.models.find((m) => m.model !== 'opus')!;
  assert.equal(mystery.dollars, null);
});

test('flat subagent run nodes carry pricing (newTokens + dollars) (FR-3, pricing)', () => {
  const tree = buildSubagentTree([
    row({ source: 'subagent', agentType: 'coder', agentId: 'a1', model: 'claude-opus-4-8', outputTokens: 100, cacheCreationTokens: 7 }),
  ]);
  const run = tree.subagents[0];
  assert.equal(run.newTokens, 7);
  assert.ok(run.dollars !== null && run.dollars > 0, 'a priced run node carries a positive dollar figure');
});

import { freezeSubagentOrder } from './subagent-tree';

test('freezeSubagentOrder keeps prior order, appends new runs in spend order (NFR-7)', () => {
  const mk = (key: string, tokens: number) => ({ key, kind: 'run' as const, label: key, agentType: key, tokens, models: [], reqs: 1, firstMs: 0, lastMs: 1, newTokens: 0, dollars: 0 });
  // Frozen order saw [A, B]; current spend order is [C(new,300), B(200), A(100)].
  const current = [mk('C', 300), mk('B', 200), mk('A', 100)];
  const result = freezeSubagentOrder(current, ['A', 'B']);
  assert.deepEqual(result.map((n) => n.key), ['A', 'B', 'C'], 'A,B hold their frozen order; C appended');
});

test('freezeSubagentOrder with empty frozen list is identity (first turn) (NFR-7)', () => {
  const mk = (key: string, tokens: number) => ({ key, kind: 'run' as const, label: key, agentType: key, tokens, models: [], reqs: 1, firstMs: 0, lastMs: 1, newTokens: 0, dollars: 0 });
  const current = [mk('B', 200), mk('A', 100)];
  assert.deepEqual(freezeSubagentOrder(current, []).map((n) => n.key), ['B', 'A']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
