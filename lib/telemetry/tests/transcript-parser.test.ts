import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { parseEvents, truncateBody } from '../src/transcript-parser.js';

function write(lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return file;
}

it('maps text, thinking, tool_use (+file_change for Edit) and tool_result; skips unmodeled (FR-2, AD-5, DD-1)', () => {
  const file = write([
    { type: 'user', requestId: 'r0', timestamp: 't0', message: { role: 'user', content: 'do the thing' } },
    { type: 'assistant', requestId: 'r1', timestamp: 't1', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'on it' },
      { type: 'tool_use', id: 'tu_1', name: 'Edit', input: { file_path: '/a.ts' } },
    ] } },
    { type: 'user', requestId: 'r2', timestamp: 't2', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false },
    ] } },
    { type: 'file-history-snapshot', messageId: 'x', snapshot: {} },   // unmodeled — skipped
  ]);
  const kinds = parseEvents(file).map((e) => e.kind);
  expect(kinds).toEqual(['message', 'thinking', 'message', 'tool_call', 'file_change', 'tool_result']);
});

it('truncates a heavy body and marks it (AD-10)', () => {
  const big = 'x'.repeat(20 * 1024);
  const body = truncateBody(big);
  expect(body.truncated).toBe(true);
  expect(body.fullBytes).toBe(20 * 1024);
  expect(body.text.length).toBeLessThan(big.length);
});
