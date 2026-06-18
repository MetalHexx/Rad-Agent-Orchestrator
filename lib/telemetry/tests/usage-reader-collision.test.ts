import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUsageForDates } from '../src/read/usage-reader.js';

describe('readUsageForDates — composite key must not collide (FR-4, AD-3)', () => {
  it('keeps two records whose pairs collide only under unseparated concatenation', () => {
    const root = mkdtempSync(join(tmpdir(), 'usage-collision-'));
    const dir = join(root, 'usage');
    mkdirSync(dir);
    const a = { sessionId: 'ab', usageId: 'cdef', timestamp: '2026-06-01T00:00:00Z', inputTokens: 1, outputTokens: 1 };
    const b = { sessionId: 'abc', usageId: 'def', timestamp: '2026-06-01T00:00:01Z', inputTokens: 2, outputTokens: 2 };
    writeFileSync(
      join(dir, 'usage-2026-06-01-x.ndjson'),
      JSON.stringify(a) + '\n' + JSON.stringify(b) + '\n',
    );
    try {
      const rows = readUsageForDates({ root, dates: ['2026-06-01'] });
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => `${r.sessionId}:${r.usageId}`))).toEqual(
        new Set(['ab:cdef', 'abc:def']),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
