import { describe, it, expect, vi } from 'vitest';

// Directory scan lists two partitions; the first throws ENOENT at read time
// (it was pruned after enumeration). Reads must tolerate the disappearance.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: () => true,
    readdirSync: () =>
      ['usage-2026-06-01-gone.ndjson', 'usage-2026-06-01-live.ndjson'] as never,
    readFileSync: ((p: unknown) => {
      if (String(p).includes('gone')) {
        const err = new Error('partition vanished') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return [
        JSON.stringify({
          sessionId: 's1',
          usageId: 'u1',
          timestamp: '2026-06-01T00:00:00Z',
          inputTokens: 5,
          outputTokens: 7,
        }),
        '',
      ].join('\n');
    }) as never,
  };
});

import { readUsageForDates } from '../src/read/usage-reader.js';

describe('readUsageForDates — partition disappearance tolerance (NFR-6)', () => {
  it('skips a partition that throws ENOENT at read time and returns sibling rows', () => {
    const rows = readUsageForDates({ root: '/virtual', dates: ['2026-06-01'] });
    expect(rows.map((r) => r.usageId)).toEqual(['u1']);
  });
});
