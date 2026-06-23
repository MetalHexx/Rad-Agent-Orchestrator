import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { NdjsonSink } from '../src/sink/ndjson-sink.js';
import { pruneAgedPartitions } from '../src/retention.js';
import { SCHEMA_VERSION, type TelemetryRecord } from '../src/types.js';

function rec(id: string, session: string, day: string): TelemetryRecord {
  return { schemaVersion: SCHEMA_VERSION, harness: 'claude-code', usageId: id, sessionId: session,
    timestamp: `${day}T12:00:00Z`, model: 'm', inputTokens: 1, outputTokens: 2, source: 'subagent',
    pointers: { sourceFile: 'f.jsonl', requestId: id } };
}

it('prunes a transcript dir whose session aged out, keeps a live one (FR-8, AD-9)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tret-'));
  const sink = new NdjsonSink({ root });
  sink.write([rec('old', 'sOld', '2026-05-01')]);   // aged out
  sink.write([rec('new', 'sNew', '2026-06-15')]);   // live
  for (const s of ['sOld', 'sNew']) {
    fs.mkdirSync(path.join(root, 'transcripts', s), { recursive: true });
    fs.writeFileSync(path.join(root, 'transcripts', s, 'main.json'), '{}');
  }
  pruneAgedPartitions({ root, maxAgeDays: 14, now: new Date('2026-06-15T12:00:00Z') });
  expect(fs.existsSync(path.join(root, 'transcripts', 'sOld'))).toBe(false);
  expect(fs.existsSync(path.join(root, 'transcripts', 'sNew'))).toBe(true);
});
