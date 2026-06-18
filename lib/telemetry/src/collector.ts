import type {
  CaptureSignal, CheckpointStore, HarnessAdapter, OperationEventStore, TelemetrySink,
} from './types.js';

export interface CaptureResult { written: number; skipped: number; locked: boolean; }

export class TelemetryCollector {
  constructor(
    private readonly adapter: HarnessAdapter,
    private readonly sink: TelemetrySink,
    private readonly checkpoint: CheckpointStore,
    private readonly ops?: OperationEventStore, // injected only in TELEMETRY-4 (AD-9)
  ) {}

  capture(signal: CaptureSignal): CaptureResult {
    if (!this.checkpoint.tryLock(signal.sessionId)) return { written: 0, skipped: 0, locked: true };
    try {
      const seen = this.checkpoint.seen(signal.sessionId);
      let rows = this.adapter.capture(signal, seen); // sweep: all un-checkpointed usageIds (FR-4)
      if (this.ops) {
        const ops = this.ops;
        rows = rows.map((r) => ({ ...r, operation: r.operation ?? ops.resolve(r, signal) }));
      }
      this.sink.write(rows);
      this.checkpoint.commit(signal.sessionId, new Set([...seen, ...rows.map((r) => r.usageId)]));
      return { written: rows.length, skipped: seen.size, locked: false };
    } finally {
      this.checkpoint.unlock(signal.sessionId);
    }
  }
}
