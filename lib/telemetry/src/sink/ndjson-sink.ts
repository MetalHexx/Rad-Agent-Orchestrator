import fs from 'node:fs';
import path from 'node:path';
import type { TelemetryRecord, TelemetrySink } from '../types.js';

export class NdjsonSink implements TelemetrySink {
  constructor(private readonly opts: { root: string }) {}
  write(records: TelemetryRecord[]): void {
    if (records.length === 0) return;
    const dir = path.join(this.opts.root, 'usage');
    fs.mkdirSync(dir, { recursive: true });
    const byPartition = new Map<string, string[]>();
    for (const r of records) {
      const day = r.timestamp.slice(0, 10); // YYYY-MM-DD
      const file = path.join(dir, `usage-${day}-${r.sessionId}.ndjson`);
      (byPartition.get(file) ?? byPartition.set(file, []).get(file)!).push(JSON.stringify(r));
    }
    for (const [file, lines] of byPartition) fs.appendFileSync(file, lines.join('\n') + '\n', 'utf8');
  }
}
