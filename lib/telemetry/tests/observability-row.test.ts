import { describe, it, expect } from 'vitest';
import { toObservabilityUsageRow } from '../src/read/observability-row.js';

it('projects to exactly the eight consumer fields, dropping pointers/extra/etc (DD-1, DD-2, NFR-2)', () => {
  const record = {
    schemaVersion: 1, usageId: 'u1', sessionId: 's1', timestamp: '2026-06-17T00:00:00Z',
    model: 'claude-opus-4-8', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4,
    source: 'main-agent', agentType: 'x', worktree: 'C:\\r',
    pointers: { sourceFile: '/log.jsonl', requestId: 'req_x' }, extra: { a: 1 },
  } as never;
  const row = toObservabilityUsageRow(record);
  expect(row).toEqual({ sessionId: 's1', usageId: 'u1', timestamp: '2026-06-17T00:00:00Z', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, worktree: 'C:\\r' });
  expect('pointers' in row).toBe(false);
  expect('model' in row).toBe(false);
  expect('schemaVersion' in row).toBe(false);
});
it('omits optional fields when absent (DD-1)', () => {
  const row = toObservabilityUsageRow({ usageId: 'u2', sessionId: 's2', timestamp: 't', inputTokens: 0, outputTokens: 0 } as never);
  expect(row).toEqual({ sessionId: 's2', usageId: 'u2', timestamp: 't', inputTokens: 0, outputTokens: 0 });
});
