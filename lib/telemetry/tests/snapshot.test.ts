import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { NdjsonSink } from '../src/sink/ndjson-sink.js';
import { SCHEMA_VERSION, type TelemetryRecord } from '../src/types.js';
import { computeSessionSnapshot } from '../src/saved-sessions.js';
import { effectiveTokens } from '../src/read/effective-tokens.js';

function rec(id: string, day: string, over: Partial<TelemetryRecord>): TelemetryRecord {
  return { schemaVersion: SCHEMA_VERSION, harness: 'claude-code', usageId: id, sessionId: 'sX',
    timestamp: `${day}T12:00:00Z`, model: 'claude-opus-4-8', inputTokens: 100, outputTokens: 20,
    cacheReadTokens: 50, cacheCreationTokens: 10, source: 'main-agent', worktree: '/w',
    pointers: { sourceFile: 'f.jsonl', requestId: id }, ...over };
}

it('weights spend exactly as the shared formula (AD-4)', () => {
  expect(effectiveTokens({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheCreationTokens: 10 }))
    .toBe(100 * 1 + 20 * 5 + 50 * 0.1 + 10 * 1.25);
});

it('computes a snapshot from usage + transcripts (FR-9, NFR-3)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  new NdjsonSink({ root }).write([rec('u1', '2026-06-20', {}), rec('u2', '2026-06-20', { timestamp: '2026-06-20T12:05:00Z' })]);
  const txDir = path.join(root, 'transcripts', 'sX'); fs.mkdirSync(txDir, { recursive: true });
  const main = { transcriptId: 'sX', sessionId: 'sX', harness: 'claude-code', role: 'main', model: ['claude-opus-4-8'],
    tokens: { in: 200, out: 40, cacheRead: 100, cacheCreate: 20 },
    toolSummary: { total: 7, byName: {}, errors: 2 }, filesTouched: ['a.ts', 'b.ts'], events: [] };
  const sub = { transcriptId: 'agentA', sessionId: 'sX', harness: 'claude-code', role: 'subagent', model: ['claude-haiku-4-5'],
    tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
    toolSummary: { total: 3, byName: {}, errors: 1 }, filesTouched: ['b.ts', 'c.ts'], events: [] };
  fs.writeFileSync(path.join(txDir, 'main.json'), JSON.stringify(main));
  fs.writeFileSync(path.join(txDir, 'agent-agentA.json'), JSON.stringify(sub));

  const snap = computeSessionSnapshot(root, 'sX');
  expect(snap.toolCalls).toBe(10);          // 7 + 3
  expect(snap.toolErrors).toBe(3);          // 2 + 1
  expect(snap.subagents).toBe(1);           // one subagent node
  expect(snap.filesTouched).toBe(3);        // {a,b,c}
  expect(snap.model).toBe('claude-opus-4-8');
  expect(snap.worktree).toBe('/w');
  expect(snap.durationMs).toBe(5 * 60 * 1000);
  expect(snap.tokens.input).toBe(200);      // summed across the two usage rows
  expect(snap.totalSpend).toBeGreaterThan(0);
});
