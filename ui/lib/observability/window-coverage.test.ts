import assert from 'node:assert/strict';
import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import { deriveSessions } from './sessions';
import { buildSubagentTree } from './subagent-tree';
import { windowCoverage, sessionWindowCoverage } from './window-coverage';

function row(p: Partial<ObservabilityUsageRow>): ObservabilityUsageRow {
  return { sessionId: 's1', usageId: Math.random().toString(36).slice(2), timestamp: '2026-06-21T00:00:00.000Z', inputTokens: 0, outputTokens: 0, model: 'claude-opus-4-8', source: 'main-agent', ...p };
}

let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); console.log(`  ✓ ${name}`); passed++; } catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; } }

test('full window covering the whole span → ~1 (FR-10)', () => {
  const s = { sessionId: 's1', worktree: undefined, startedMs: 100, lastMs: 200, spend: 0, rows: [] };
  assert.ok(Math.abs(windowCoverage(s, 0, 1000) - 1) < 1e-9);
});

test('half window → ~0.5 (FR-10)', () => {
  const s = { sessionId: 's1', worktree: undefined, startedMs: 0, lastMs: 100, spend: 0, rows: [] };
  assert.ok(Math.abs(windowCoverage(s, 0, 50) - 0.5) < 1e-9);
});

test('zero-duration session → 1 (no divide-by-zero) (FR-10)', () => {
  const s = { sessionId: 's1', worktree: undefined, startedMs: 100, lastMs: 100, spend: 0, rows: [] };
  assert.equal(windowCoverage(s, 0, 1000), 1);
});

test('INVARIANT: tree.windowTotal === session.spend over the same rows (AD-6, AD-3)', () => {
  const rows = [
    row({ source: 'main-agent', outputTokens: 100 }),
    row({ source: 'subagent', agentType: 'coder', agentId: 'a1', outputTokens: 40 }),
    row({ source: 'subagent', agentType: 'reviewer', agentId: 'b1', inputTokens: 200 }),
  ];
  const session = deriveSessions(rows).find((s) => s.sessionId === 's1')!;
  const tree = buildSubagentTree(rows);
  assert.equal(tree.windowTotal, session.spend);
});

test('sessionWindowCoverage uses the unclipped session span so start-truncation is detected (FR-10)', () => {
  const base = Date.parse('2026-06-21T00:00:00.000Z');
  // Session truly spans base..base+100ms. Two rows, the first BEFORE the analyzed window start.
  const rows = [
    row({ sessionId: 's1', timestamp: new Date(base).toISOString(), outputTokens: 10 }),
    row({ sessionId: 's1', timestamp: new Date(base + 100).toISOString(), outputTokens: 10 }),
  ];
  const rangeStart = base + 50;       // window starts mid-session → ~50% of the span is truncated off the front
  const rangeEnd = base + 1000;
  // Correct: computed from the UNCLIPPED rows, coverage drops below 1.
  assert.ok(sessionWindowCoverage(rows, 's1', rangeStart, rangeEnd) < 0.99, 'unclipped coverage detects start-truncation');
  // Demonstrates the prior bug: feeding only the windowed rows masks it (the front row is gone, span collapses → ~1).
  const clipped = rows.filter((r) => Date.parse(r.timestamp) >= rangeStart);
  assert.equal(sessionWindowCoverage(clipped, 's1', rangeStart, rangeEnd), 1, 'clipped rows mask the truncation');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
