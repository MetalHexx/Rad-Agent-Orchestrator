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

describe('readUsageForDates', () => {
  it('returns parsed records for each requested UTC date (FR-2)', () => {
    const root = tmpRoot();
    writePartition(root, '2026-06-17', 's1', [{ usageId: 'u1', sessionId: 's1', timestamp: '2026-06-17T00:00:00Z', inputTokens: 1, outputTokens: 2, worktree: 'C:\\r' }]);
    const rows = readUsageForDates({ root, dates: ['2026-06-17'] });
    expect(rows).toHaveLength(1);
    expect(rows[0].usageId).toBe('u1');
    expect(rows[0].worktree).toBe('C:\\r');
    rmSync(root, { recursive: true, force: true });
  });
  it('returns [] for a missing usage directory, never throws (FR-3)', () => {
    const root = tmpRoot();
    expect(readUsageForDates({ root, dates: ['2026-06-17'] })).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
  it('skips malformed lines and keeps valid rows (NFR-4)', () => {
    const root = tmpRoot(); const dir = join(root, 'usage'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'usage-2026-06-17-s1.ndjson'), '{bad json}\n' + JSON.stringify({ usageId: 'u2', sessionId: 's1', timestamp: '2026-06-17T00:00:00Z', inputTokens: 3, outputTokens: 4 }) + '\n');
    expect(readUsageForDates({ root, dates: ['2026-06-17'] }).map((r) => r.usageId)).toEqual(['u2']);
    rmSync(root, { recursive: true, force: true });
  });
});
