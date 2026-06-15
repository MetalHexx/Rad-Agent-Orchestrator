import { describe, it, expect } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { ClaudeCodeAdapter, subagentPathFor } from '../src/adapter/claude-code-adapter.js';
import type { HookEvent } from '../src/types.js';

function writeTranscript(lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-'));
  const file = path.join(dir, 'session-abc.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return file;
}
const asst = (requestId: string, output: number, extra: Record<string, unknown> = {}) => ({
  type: 'assistant', requestId, timestamp: '2026-06-15T12:00:00Z',
  message: { model: 'claude-opus-4-8', usage: { input_tokens: 5, output_tokens: output, cache_read_input_tokens: 10 } },
  ...extra,
});

describe('ClaudeCodeAdapter', () => {
  it('emits one record per radOrcId keeping the final line, excluding sidechain and usage-less rows (FR-3)', () => {
    const file = writeTranscript([
      asst('req_1', 3),                       // intermediate
      asst('req_1', 98),                      // final — wins
      asst('req_2', 40, { isSidechain: true }), // excluded
      { type: 'assistant', requestId: 'req_3', message: {} }, // no usage — excluded
    ]);
    const signal: HookEvent = { sessionId: 's1', cwd: '.', kind: 'Stop', event: 'Stop', transcriptPath: file };
    const records = new ClaudeCodeAdapter().capture(signal, new Set());
    expect(records).toHaveLength(1);
    expect(records[0].radOrcId).toBe('req_1');
    expect(records[0].outputTokens).toBe(98);        // final line wins (FR-3)
    expect(records[0].cacheReadTokens).toBe(10);
    expect(records[0].source).toBe('main-agent');
  });

  it('computes radOrcId = requestId, emits lean pointers, and leaves operation dormant (AD-2, NFR-8, AD-9)', () => {
    const file = writeTranscript([asst('req_x', 7)]);
    const signal: HookEvent = { sessionId: 's1', cwd: '.', kind: 'Stop', event: 'Stop', transcriptPath: file };
    const [r] = new ClaudeCodeAdapter().capture(signal, new Set());
    expect(r.radOrcId).toBe('req_x');
    expect(r.pointers.requestId).toBe('req_x');
    expect(r.pointers.sourceFile).toBe(file);
    expect(r.operation).toBeUndefined();             // dormant (AD-9)
    expect('prompt' in r || 'response' in r).toBe(false); // no bodies (NFR-8)
  });

  it('skips radOrcIds already in the checkpoint seen-set (FR-3)', () => {
    const file = writeTranscript([asst('req_1', 98)]);
    const signal: HookEvent = { sessionId: 's1', cwd: '.', kind: 'Stop', event: 'Stop', transcriptPath: file };
    expect(new ClaudeCodeAdapter().capture(signal, new Set(['req_1']))).toHaveLength(0);
  });

  it('derives the subagent transcript path with OS-correct separators (NFR-6)', () => {
    const main = path.join('C--dev', 'projects', 'slug', 'session-abc.jsonl');
    const expected = path.join('C--dev', 'projects', 'slug', 'session-abc', 'subagents', 'agent-a0d327.jsonl');
    expect(subagentPathFor(main, 'a0d327')).toBe(expected);
  });
});
