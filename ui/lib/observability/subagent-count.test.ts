import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSubagents } from './subagent-count';
import type { SessionAgg } from './sessions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function row(partial: any) {
  return {
    sessionId: 's', usageId: 'u', timestamp: '2026-06-21T00:00:00.000Z', model: 'm',
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    source: 'main-agent', ...partial,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function session(rows: any[]): SessionAgg {
  return { sessionId: 's', startedMs: 0, lastMs: 0, spend: 0, rows };
}

test('counts distinct subagent agentIds (FR-3)', () => {
  const s = session([
    row({ source: 'main-agent' }),
    row({ source: 'subagent', agentId: 'a1' }),
    row({ source: 'subagent', agentId: 'a1' }),
    row({ source: 'subagent', agentId: 'a2' }),
  ]);
  assert.equal(countSubagents(s), 2);
});

test('subagent rows missing agentId are uncounted (NFR-2)', () => {
  const s = session([
    row({ source: 'subagent' }),
    row({ source: 'subagent', agentId: 'a1' }),
  ]);
  assert.equal(countSubagents(s), 1);
});

test('a pure main-agent session reads 0 (FR-3)', () => {
  const s = session([row({ source: 'main-agent' }), row({ source: 'main-agent' })]);
  assert.equal(countSubagents(s), 0);
});
