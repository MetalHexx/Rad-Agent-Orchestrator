import { describe, it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../src/transcript-parser.js';
import { ClaudeCodeAdapter } from '../src/adapter/claude-code-adapter.js';
import { effectiveTokens } from '../src/read/effective-tokens.js';
import type { HookEvent } from '../src/types.js';

function write(lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpd-'));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return file;
}

const asst = (requestId: string, output: number, cacheRead: number, extraUsage: Record<string, number> = {}) => ({
  type: 'assistant', requestId, timestamp: '2026-06-15T12:00:00Z',
  message: {
    model: 'claude-opus-4-8',
    usage: { input_tokens: 5, output_tokens: output, cache_read_input_tokens: cacheRead, ...extraUsage },
  },
});

describe('parseTranscript token dedupe (modal path)', () => {
  it('collapses a 33-line/11-request transcript to exactly 11 requests, without inflating cache-read', () => {
    const lines: unknown[] = [];
    for (let i = 0; i < 11; i++) {
      const req = `req_${i}`;
      const cacheRead = 100 + i; // repeats identically across a request's lines — taken once, not summed
      lines.push(asst(req, 2, cacheRead));
      lines.push(asst(req, 2, cacheRead));
      lines.push(asst(req, 10 + i, cacheRead, { cache_creation_input_tokens: 1 })); // final line — max output wins
    }
    expect(lines).toHaveLength(33);
    const file = write(lines);
    const t = parseTranscript(file, { transcriptId: 's1', sessionId: 's1', harness: 'claude-code', role: 'main' });

    const expectedIn = 5 * 11;
    const expectedOut = Array.from({ length: 11 }, (_, i) => 10 + i).reduce((a, b) => a + b, 0);
    const expectedCacheRead = Array.from({ length: 11 }, (_, i) => 100 + i).reduce((a, b) => a + b, 0);
    expect(t.tokens.in).toBe(expectedIn);
    expect(t.tokens.out).toBe(expectedOut);
    expect(t.tokens.cacheRead).toBe(expectedCacheRead); // would be 3x inflated (33 lines) without the dedupe
    expect(t.tokens.cacheCreate).toBe(11); // one contribution per request, not per line
  });

  it('selects the max/final output_tokens for a request streaming [4, 4, 4, 347]', () => {
    const file = write([
      asst('req_x', 4, 10), asst('req_x', 4, 10), asst('req_x', 4, 10), asst('req_x', 347, 10),
    ]);
    const t = parseTranscript(file, { transcriptId: 's1', sessionId: 's1', harness: 'claude-code', role: 'main' });
    expect(t.tokens.out).toBe(347);
    expect(t.tokens.cacheRead).toBe(10); // representative value, not summed 4x
  });

  it('falls back to message.id when requestId is absent, still collapsing to one contribution per request', () => {
    const line = (id: string, output: number) => ({
      type: 'assistant', timestamp: '2026-06-15T12:00:00Z',
      message: { id, model: 'claude-opus-4-8', usage: { input_tokens: 5, output_tokens: output, cache_read_input_tokens: 10 } },
    });
    const file = write([line('msg_a', 4), line('msg_a', 99), line('msg_b', 6)]);
    const t = parseTranscript(file, { transcriptId: 's1', sessionId: 's1', harness: 'claude-code', role: 'main' });
    expect(t.tokens.out).toBe(99 + 6);
    expect(t.tokens.in).toBe(10);
  });

  it('keeps lines with neither requestId nor message.id distinct, instead of merging them into one bucket', () => {
    const line = (output: number) => ({
      type: 'assistant', timestamp: '2026-06-15T12:00:00Z',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: 5, output_tokens: output, cache_read_input_tokens: 10 } },
    });
    const file = write([line(4), line(6), line(9)]);
    const t = parseTranscript(file, { transcriptId: 's1', sessionId: 's1', harness: 'claude-code', role: 'main' });
    // Without a requestId or message.id there is no basis to treat these as the same
    // streamed request, so each unkeyed line must be counted on its own — summed, not collapsed.
    expect(t.tokens.out).toBe(4 + 6 + 9);
    expect(t.tokens.in).toBe(5 * 3);
  });
});

describe('row/modal parity — golden subagent fixture', () => {
  const GOLDEN = fileURLToPath(new URL('./fixtures/subagent-golden.jsonl', import.meta.url));

  it('the harvested row total equals the parsed transcript total on the same input (anti-divergence guard)', () => {
    const signal: HookEvent = { sessionId: 's1', cwd: '.', kind: 'Stop', event: 'Stop', transcriptPath: GOLDEN };
    const records = new ClaudeCodeAdapter().capture(signal, new Set());
    expect(records.map((r) => r.usageId).sort()).toEqual(['req_g1', 'req_g2', 'req_g3']); // 6 raw lines -> 3 requests

    const rowTotals = records.reduce((acc, r) => ({
      in: acc.in + r.inputTokens,
      out: acc.out + r.outputTokens,
      cacheRead: acc.cacheRead + (r.cacheReadTokens ?? 0),
      cacheCreate: acc.cacheCreate + (r.cacheCreationTokens ?? 0),
    }), { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 });

    const t = parseTranscript(GOLDEN, { transcriptId: 's1', sessionId: 's1', harness: 'claude-code', role: 'main' });

    // Row (harvest) and modal (transcript) paths must select the same final-per-request
    // values — this is the seam the whole task exists to close.
    expect({ in: t.tokens.in, out: t.tokens.out, cacheRead: t.tokens.cacheRead, cacheCreate: t.tokens.cacheCreate })
      .toEqual(rowTotals);

    // Golden values hand-derived from the fixture's final line per request:
    // req_g1 (8/120/200/15), req_g2 (6/45/150/5), req_g3 (9/260/300/20).
    expect(rowTotals).toEqual({ in: 23, out: 425, cacheRead: 650, cacheCreate: 40 });

    const rowNewTokens = rowTotals.in + rowTotals.out;
    const modalNewTokens = t.tokens.in + t.tokens.out;
    expect(modalNewTokens).toBe(rowNewTokens);
    expect(rowNewTokens).toBe(448);

    const rowEffective = records.reduce((sum, r) => sum + effectiveTokens(r), 0);
    const modalEffective = effectiveTokens({
      inputTokens: t.tokens.in, outputTokens: t.tokens.out,
      cacheReadTokens: t.tokens.cacheRead, cacheCreationTokens: t.tokens.cacheCreate,
    });
    expect(modalEffective).toBe(rowEffective); // cost-weighted total parity
  });
});
