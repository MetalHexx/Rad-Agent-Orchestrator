import { describe, it, expect } from 'vitest';
import { TelemetryCollector } from '../src/collector.js';
import {
  SCHEMA_VERSION,
  type CaptureSignal, type CheckpointStore, type HarnessAdapter,
  type OperationEventStore, type TelemetryRecord, type TelemetrySink,
} from '../src/types.js';

it('commits usageId values into the checkpoint seen-set (FR-9)', () => {
  const committed: string[] = [];
  const adapter = { capture: () => [{ usageId: 'u1', sessionId: 's1', timestamp: '2026-06-17T00:00:00Z', inputTokens: 0, outputTokens: 0 }] };
  const sink = { write: () => {} };
  const checkpoint = {
    tryLock: () => true,
    seen: () => new Set<string>(),
    commit: (_s: string, ids: Set<string>) => { committed.push(...ids); },
    unlock: () => {},
  };
  const collector = new TelemetryCollector(adapter as never, sink as never, checkpoint as never);
  collector.capture({ sessionId: 's1', cwd: '', kind: 'Stop' } as never);
  expect(committed).toContain('u1');
});

const row = (id: string): TelemetryRecord => ({
  schemaVersion: SCHEMA_VERSION, harness: 'fake', usageId: id, sessionId: 's1',
  timestamp: '2026-06-15T12:00:00Z', model: 'm', inputTokens: 1, outputTokens: 2,
  source: 'subagent', pointers: { sourceFile: 'f' },
});
class FakeAdapter implements HarnessAdapter {
  readonly harness = 'fake';
  constructor(private all: string[]) {}
  identity(): string { return ''; }
  capture(_s: CaptureSignal, seen: Set<string>): TelemetryRecord[] {
    return this.all.filter((id) => !seen.has(id)).map(row);
  }
}
class FakeSink implements TelemetrySink { written: TelemetryRecord[] = []; write(r: TelemetryRecord[]) { this.written.push(...r); } }
class FakeCheckpoint implements CheckpointStore {
  store = new Map<string, Set<string>>(); locked = new Set<string>();
  seen(s: string) { return new Set(this.store.get(s) ?? []); }
  commit(s: string, ids: Set<string>) { this.store.set(s, new Set(ids)); }
  tryLock(s: string) { if (this.locked.has(s)) return false; this.locked.add(s); return true; }
  unlock(s: string) { this.locked.delete(s); }
}
const signal: CaptureSignal = { sessionId: 's1', cwd: '.', kind: 'Stop' };

describe('TelemetryCollector', () => {
  it('writes new rows and commits the seen high-water (FR-4, FR-5)', () => {
    const sink = new FakeSink(); const cp = new FakeCheckpoint();
    const res = new TelemetryCollector(new FakeAdapter(['a', 'b']), sink, cp).capture(signal);
    expect(res.written).toBe(2);
    expect(sink.written.map((r) => r.usageId)).toEqual(['a', 'b']);
    expect([...cp.seen('s1')].sort()).toEqual(['a', 'b']);
  });

  it('is an idempotent sweep — a second capture writes nothing new (FR-4, FR-5)', () => {
    const sink = new FakeSink(); const cp = new FakeCheckpoint();
    const adapter = new FakeAdapter(['a', 'b']);
    new TelemetryCollector(adapter, sink, cp).capture(signal);
    const res = new TelemetryCollector(adapter, sink, cp).capture(signal);
    expect(res.written).toBe(0);
    expect(sink.written).toHaveLength(2);
  });

  it('skips when the session lock is held (NFR-1, FR-4)', () => {
    const cp = new FakeCheckpoint(); cp.tryLock('s1'); // pre-held
    const sink = new FakeSink();
    const res = new TelemetryCollector(new FakeAdapter(['a']), sink, cp).capture(signal);
    expect(res).toEqual({ written: 0, skipped: 0, locked: true });
    expect(sink.written).toHaveLength(0);
  });

  it('leaves operation undefined without an ops collaborator, stamps it with one (AD-9, AD-3)', () => {
    const withoutOps = new FakeSink();
    new TelemetryCollector(new FakeAdapter(['a']), withoutOps, new FakeCheckpoint()).capture(signal);
    expect(withoutOps.written[0].operation).toBeUndefined();

    const ops: OperationEventStore = { resolve: () => ({ kind: 'code_review', phase: 'P02' }) };
    const withOps = new FakeSink();
    new TelemetryCollector(new FakeAdapter(['a']), withOps, new FakeCheckpoint(), ops).capture(signal);
    expect(withOps.written[0].operation).toEqual({ kind: 'code_review', phase: 'P02' });
  });
});
