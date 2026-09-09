import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { NdjsonSink } from '../src/sink/ndjson-sink.js';
import { pruneAgedPartitions } from '../src/retention.js';
import { saveSession, type SavedSessionSnapshot } from '../src/saved-sessions.js';
import { SCHEMA_VERSION, type TelemetryRecord } from '../src/types.js';
import { PRICING_VERSION } from '../src/read/pricing.js';

const SNAP: SavedSessionSnapshot = { worktree: null, model: null, startedAt: '', durationMs: 0, totalSpend: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, toolCalls: 0, toolErrors: 0, subagents: 0, filesTouched: 0,
  harness: null, costUsd: 0, pricingVersion: PRICING_VERSION };
function rec(id: string, session: string, day: string): TelemetryRecord {
  return { schemaVersion: SCHEMA_VERSION, harness: 'claude-code', usageId: id, sessionId: session,
    timestamp: `${day}T12:00:00Z`, model: 'm', inputTokens: 1, outputTokens: 2, source: 'subagent',
    pointers: { sourceFile: 'f.jsonl', requestId: id } };
}

it('keeps an aged saved session but prunes an aged non-saved one (FR-10, AD-5)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exempt-'));
  const sink = new NdjsonSink({ root });
  sink.write([rec('a', 'sSaved', '2026-05-01')]);     // aged
  sink.write([rec('b', 'sUnsaved', '2026-05-01')]);   // aged
  for (const s of ['sSaved', 'sUnsaved']) {
    fs.mkdirSync(path.join(root, 'transcripts', s), { recursive: true });
    fs.writeFileSync(path.join(root, 'transcripts', s, 'main.json'), '{}');
  }
  saveSession(root, { sessionId: 'sSaved', snapshot: SNAP });

  pruneAgedPartitions({ root, maxAgeDays: 14, now: new Date('2026-06-15T12:00:00Z') });

  expect(fs.existsSync(path.join(root, 'usage', 'usage-2026-05-01-sSaved.ndjson'))).toBe(true);
  expect(fs.existsSync(path.join(root, 'transcripts', 'sSaved'))).toBe(true);
  expect(fs.existsSync(path.join(root, 'usage', 'usage-2026-05-01-sUnsaved.ndjson'))).toBe(false);
  expect(fs.existsSync(path.join(root, 'transcripts', 'sUnsaved'))).toBe(false);
});

it('unions caller-supplied exempt ids with the saved index, sparing all three artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exempt-union-'));
  const sink = new NdjsonSink({ root });
  const sessions = ['sSaved', 'sProject', 'sNeither'];
  for (const s of sessions) {
    sink.write([rec(s, s, '2026-05-01')]);                             // all aged
    fs.mkdirSync(path.join(root, 'transcripts', s), { recursive: true });
    fs.writeFileSync(path.join(root, 'transcripts', s, 'main.json'), '{}');
    fs.mkdirSync(path.join(root, 'checkpoints'), { recursive: true });
    fs.writeFileSync(path.join(root, 'checkpoints', `${s}.json`), '{}');
  }
  saveSession(root, { sessionId: 'sSaved', snapshot: SNAP });

  pruneAgedPartitions({ root, maxAgeDays: 14, now: new Date('2026-06-15T12:00:00Z'), exemptSessionIds: ['sProject'] });

  for (const s of ['sSaved', 'sProject']) {
    expect(fs.existsSync(path.join(root, 'usage', `usage-2026-05-01-${s}.ndjson`))).toBe(true);
    expect(fs.existsSync(path.join(root, 'checkpoints', `${s}.json`))).toBe(true);
    expect(fs.existsSync(path.join(root, 'transcripts', s))).toBe(true);
  }
  expect(fs.existsSync(path.join(root, 'usage', 'usage-2026-05-01-sNeither.ndjson'))).toBe(false);
  expect(fs.existsSync(path.join(root, 'checkpoints', 'sNeither.json'))).toBe(false);
  expect(fs.existsSync(path.join(root, 'transcripts', 'sNeither'))).toBe(false);
});
