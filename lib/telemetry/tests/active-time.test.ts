import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { NdjsonSink } from '../src/sink/ndjson-sink.js';
import { computeActiveTimeMs, ACTIVE_TIME_GAP_MS } from '../src/read/active-time.js';
import { SCHEMA_VERSION, type TelemetryRecord } from '../src/types.js';

const MINUTE = 60_000;

function rec(id: string, session: string, timestamp: string, extra: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return { schemaVersion: SCHEMA_VERSION, harness: 'claude-code', usageId: id, sessionId: session,
    timestamp, model: 'm', inputTokens: 1, outputTokens: 2, source: 'main-agent',
    pointers: { sourceFile: 'f.jsonl', requestId: id }, ...extra };
}

function seed(records: TelemetryRecord[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'active-time-'));
  new NdjsonSink({ root }).write(records);
  return root;
}

it('sums a gap under the threshold and ignores one over it', () => {
  const root = seed([
    rec('a', 's1', '2026-05-01T10:00:00Z'),
    rec('b', 's1', '2026-05-01T10:30:00Z'),   // +30m, counted
    rec('c', 's1', '2026-05-01T12:30:00Z'),   // +2h, dropped
    rec('d', 's1', '2026-05-01T12:40:00Z'),   // +10m, counted
  ]);

  expect(computeActiveTimeMs({ root, sessionId: 's1' })).toBe(40 * MINUTE);
});

it('excludes a delta exactly equal to the gap', () => {
  const root = seed([
    rec('a', 's1', '2026-05-01T10:00:00Z'),
    rec('b', 's1', '2026-05-01T11:00:00Z'),
  ]);

  expect(computeActiveTimeMs({ root, sessionId: 's1' })).toBe(0);
  expect(computeActiveTimeMs({ root, sessionId: 's1', gapMs: ACTIVE_TIME_GAP_MS + 1 })).toBe(60 * MINUTE);
});

it('reports zero for a session with no usage rows', () => {
  const root = seed([rec('a', 'other', '2026-05-01T10:00:00Z')]);

  expect(computeActiveTimeMs({ root, sessionId: 's1' })).toBe(0);
  expect(computeActiveTimeMs({ root: path.join(root, 'nowhere'), sessionId: 's1' })).toBe(0);
});

it('walks only the requested session even when another session shares the date', () => {
  const root = seed([
    rec('a', 's1', '2026-05-01T10:00:00Z'),
    rec('b', 's1', '2026-05-01T10:15:00Z'),
    rec('x', 's2', '2026-05-01T10:05:00Z'),
    rec('y', 's2', '2026-05-01T10:45:00Z'),
  ]);

  expect(computeActiveTimeMs({ root, sessionId: 's1' })).toBe(15 * MINUTE);
});

it('counts pipeline subagent rows rather than filtering them out', () => {
  const root = seed([
    rec('a', 's1', '2026-05-01T10:00:00Z', { source: 'subagent', agentType: 'rad-orc:coder' }),
    rec('b', 's1', '2026-05-01T10:20:00Z', { source: 'subagent', agentType: 'rad-orc:reviewer' }),
  ]);

  expect(computeActiveTimeMs({ root, sessionId: 's1' })).toBe(20 * MINUTE);
});

it('orders rows spanning multiple day partitions before walking deltas', () => {
  const root = seed([
    rec('b', 's1', '2026-05-02T00:10:00Z'),
    rec('a', 's1', '2026-05-01T23:50:00Z'),
  ]);

  expect(computeActiveTimeMs({ root, sessionId: 's1' })).toBe(20 * MINUTE);
});
