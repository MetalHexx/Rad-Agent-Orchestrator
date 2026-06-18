import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUsageForDates } from '../src/read/usage-reader.js';

function tmpRoot(): string { return mkdtempSync(join(tmpdir(), 'tlm-')); }
function writePartition(root: string, date: string, sid: string, rows: object[]): void {
  const dir = join(root, 'usage'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `usage-${date}-${sid}.ndjson`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

describe('readUsageForDates dedup', () => {
  it('keeps the last (complete) occurrence of a duplicate (sessionId, usageId) (FR-4)', () => {
    const root = tmpRoot();
    writePartition(root, '2026-06-17', 's1', [
      { usageId: 'u1', sessionId: 's1', timestamp: '2026-06-17T00:00:00Z', inputTokens: 0, outputTokens: 0 },
      { usageId: 'u1', sessionId: 's1', timestamp: '2026-06-17T00:00:00Z', inputTokens: 10, outputTokens: 5 },
    ]);
    const rows = readUsageForDates({ root, dates: ['2026-06-17'] });
    expect(rows).toHaveLength(1);
    expect(rows[0].inputTokens).toBe(10);
    rmSync(root, { recursive: true, force: true });
  });
  it('reads a legacy radOrcId-only row via coalesce (AD-9)', () => {
    const root = tmpRoot();
    writePartition(root, '2026-06-17', 's1', [{ radOrcId: 'legacy1', sessionId: 's1', timestamp: '2026-06-17T00:00:00Z', inputTokens: 1, outputTokens: 1 }]);
    const rows = readUsageForDates({ root, dates: ['2026-06-17'] });
    expect(rows[0].usageId).toBe('legacy1');
    rmSync(root, { recursive: true, force: true });
  });
});
