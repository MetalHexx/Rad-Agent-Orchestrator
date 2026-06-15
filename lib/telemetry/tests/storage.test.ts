import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { NdjsonSink } from '../src/sink/ndjson-sink.js';
import { FileCheckpointStore } from '../src/checkpoint/file-checkpoint-store.js';
import { pruneAgedPartitions } from '../src/retention.js';
import { SCHEMA_VERSION, type TelemetryRecord } from '../src/types.js';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'telem-'));
}
function rec(id: string, session: string, day: string): TelemetryRecord {
  return {
    schemaVersion: SCHEMA_VERSION, harness: 'claude-code', radOrcId: id,
    sessionId: session, timestamp: `${day}T12:00:00Z`, model: 'm',
    inputTokens: 1, outputTokens: 2, source: 'subagent',
    pointers: { sourceFile: 'f.jsonl', requestId: id },
  };
}

describe('NdjsonSink', () => {
  let root: string;
  beforeEach(() => { root = tmpRoot(); });

  it('writes one NDJSON line per record into a per-session daily partition (FR-6)', () => {
    new NdjsonSink({ root }).write([rec('a', 's1', '2026-06-15'), rec('b', 's1', '2026-06-15')]);
    const file = path.join(root, 'usage', 'usage-2026-06-15-s1.ndjson');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).schemaVersion).toBe(SCHEMA_VERSION);
    expect(JSON.parse(lines[1]).radOrcId).toBe('b');
  });

  it('appends across calls without truncating (FR-6)', () => {
    const sink = new NdjsonSink({ root });
    sink.write([rec('a', 's1', '2026-06-15')]);
    sink.write([rec('b', 's1', '2026-06-15')]);
    const file = path.join(root, 'usage', 'usage-2026-06-15-s1.ndjson');
    expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
  });
});

describe('FileCheckpointStore', () => {
  let root: string;
  beforeEach(() => { root = tmpRoot(); });

  it('round-trips the seen high-water set (FR-5)', () => {
    const cp = new FileCheckpointStore({ root });
    expect(cp.seen('s1').size).toBe(0);
    cp.commit('s1', new Set(['a', 'b']));
    expect([...cp.seen('s1')].sort()).toEqual(['a', 'b']);
  });

  it('stamps schemaVersion and leaves no temp file (NFR-3, NFR-7)', () => {
    new FileCheckpointStore({ root }).commit('s1', new Set(['a']));
    const dir = path.join(root, 'checkpoints');
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 's1.json'), 'utf8'));
    expect(raw.schemaVersion).toBe(SCHEMA_VERSION);
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('skip-if-held: a second lock attempt fails while held, succeeds after unlock (NFR-2)', () => {
    const cp = new FileCheckpointStore({ root });
    expect(cp.tryLock('s1')).toBe(true);
    expect(cp.tryLock('s1')).toBe(false);
    cp.unlock('s1');
    expect(cp.tryLock('s1')).toBe(true);
  });
});

describe('pruneAgedPartitions', () => {
  it('removes partitions older than the window and their orphaned checkpoints (FR-6)', () => {
    const root = tmpRoot();
    const sink = new NdjsonSink({ root });
    sink.write([rec('old', 'sOld', '2026-05-01')]);
    sink.write([rec('new', 'sNew', '2026-06-15')]);
    new FileCheckpointStore({ root }).commit('sOld', new Set(['old']));
    const pruned = pruneAgedPartitions({ root, maxAgeDays: 14, now: new Date('2026-06-15T12:00:00Z') });
    expect(pruned).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(root, 'usage', 'usage-2026-05-01-sOld.ndjson'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'usage', 'usage-2026-06-15-sNew.ndjson'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'checkpoints', 'sOld.json'))).toBe(false);
  });

  it('boundary: keeps exactly-14-day-old partition, prunes 15-day-old (FR-6, NFR-5)', () => {
    const root = tmpRoot();
    const sink = new NdjsonSink({ root });
    // 2026-06-01 is exactly 14 days before 2026-06-15 — MUST be kept
    sink.write([rec('boundary', 'sBoundary', '2026-06-01')]);
    // 2026-05-31 is 15 days before 2026-06-15 — MUST be pruned
    sink.write([rec('old15', 'sOld15', '2026-05-31')]);
    // 2026-06-15 is today — MUST be kept
    sink.write([rec('today', 'sToday', '2026-06-15')]);

    pruneAgedPartitions({ root, maxAgeDays: 14, now: new Date('2026-06-15T12:00:00Z') });

    expect(fs.existsSync(path.join(root, 'usage', 'usage-2026-06-01-sBoundary.ndjson'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'usage', 'usage-2026-05-31-sOld15.ndjson'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'usage', 'usage-2026-06-15-sToday.ndjson'))).toBe(true);
  });
});
