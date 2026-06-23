import { it, expect } from 'vitest';
import { toObservabilityUsageRow } from '../src/read/observability-row.js';

it('carries the four identity fields (model, source, agentType, agentId) alongside tokens (AD-2)', () => {
  const record = {
    schemaVersion: 1, harness: 'claude-code', usageId: 'u1', sessionId: 's1', timestamp: '2026-06-17T00:00:00Z',
    model: 'claude-opus-4-8', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4,
    source: 'subagent', agentType: 'coder', worktree: 'C:\\r',
    pointers: { sourceFile: '/log.jsonl', requestId: 'req_x', agentId: 'a_42' }, extra: { a: 1 },
  } as never;
  const row = toObservabilityUsageRow(record);
  expect(row).toEqual({
    sessionId: 's1', usageId: 'u1', timestamp: '2026-06-17T00:00:00Z',
    inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, worktree: 'C:\\r',
    model: 'claude-opus-4-8', source: 'subagent', agentType: 'coder', agentId: 'a_42',
  });
  expect('pointers' in row).toBe(false);
  expect('schemaVersion' in row).toBe(false);
});

it('keeps model + source but omits optional agentType/agentId/cache/worktree when absent (AD-2, NFR-3)', () => {
  const row = toObservabilityUsageRow({
    usageId: 'u2', sessionId: 's2', timestamp: 't', inputTokens: 0, outputTokens: 0,
    model: 'claude-haiku-4-5', source: 'main-agent', pointers: { sourceFile: '/x' },
  } as never);
  expect(row).toEqual({
    sessionId: 's2', usageId: 'u2', timestamp: 't', inputTokens: 0, outputTokens: 0,
    model: 'claude-haiku-4-5', source: 'main-agent',
  });
  expect('agentType' in row).toBe(false);
  expect('agentId' in row).toBe(false);
});

import { it as it2, expect as expect2 } from 'vitest';

it2('reads lifted top-level agentId (FR-6, AD-7)', () => {
  const row = toObservabilityUsageRow({
    schemaVersion: 2, harness: 'claude-code', usageId: 'u3', sessionId: 's3', timestamp: 't',
    model: 'm', inputTokens: 0, outputTokens: 0, source: 'subagent',
    agentId: 'a_99', pointers: { sourceFile: '/x', requestId: 'u3' },
  } as never);
  expect2(row.agentId).toBe('a_99');
});

it2('back-compat: still resolves a legacy row carrying agentId only in pointers (AD-6)', () => {
  const row = toObservabilityUsageRow({
    usageId: 'u4', sessionId: 's4', timestamp: 't', inputTokens: 0, outputTokens: 0,
    model: 'm', source: 'subagent', pointers: { sourceFile: '/x', agentId: 'legacy_1' },
  } as never);
  expect2(row.agentId).toBe('legacy_1');
});
