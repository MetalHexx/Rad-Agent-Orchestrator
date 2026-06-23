import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { parseTranscript } from '../src/transcript-parser.js';
import { buildTree } from '../src/transcript-tree.js';

function write(lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return file;
}

it('derives prompt, result, tool analytics, files touched and timing (FR-4, FR-5, AD-11)', () => {
  const file = write([
    { type: 'user', requestId: 'r0', timestamp: '2026-06-20T00:00:00Z', message: { role: 'user', content: 'spawn-prompt' } },
    { type: 'assistant', requestId: 'r1', timestamp: '2026-06-20T00:00:01Z', message: { role: 'assistant', model: 'claude-opus-4-8', usage: { input_tokens: 3, output_tokens: 4 }, content: [
      { type: 'tool_use', id: 'tu_a', name: 'Write', input: { file_path: '/f.ts' } },
      { type: 'tool_use', id: 'tu_b', name: 'Bash', input: { command: 'ls' } },
    ] } },
    { type: 'user', requestId: 'r2', timestamp: '2026-06-20T00:00:02Z', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu_b', content: 'boom', is_error: true },
    ] } },
    { type: 'assistant', requestId: 'r3', timestamp: '2026-06-20T00:00:05Z', message: { role: 'assistant', content: 'final answer' } },
  ]);
  const t = parseTranscript(file, { transcriptId: 's1', sessionId: 's1', harness: 'claude-code', role: 'main' });
  expect(t.prompt).toBe('spawn-prompt');
  expect(t.result).toBe('final answer');
  expect(t.toolSummary).toEqual({ total: 2, byName: { Write: 1, Bash: 1 }, errors: 1 });
  expect(t.filesTouched).toEqual(['/f.ts']);
  expect(t.tokens.in).toBe(3);
  expect(t.durationMs).toBe(5000);
});

it('links a subagent under the parent tool_use that spawned it, nested (FR-3, DD-2)', () => {
  const mainFile = write([
    { type: 'assistant', requestId: 'm1', timestamp: 't', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tu_spawn', name: 'Agent', input: {} },
    ] } },
  ]);
  const subFile = write([
    { type: 'user', requestId: 's1', timestamp: 't', message: { role: 'user', content: 'sub task' } },
  ]);
  const main = parseTranscript(mainFile, { transcriptId: 'sess', sessionId: 'sess', harness: 'claude-code', role: 'main' });
  const sub = parseTranscript(subFile, { transcriptId: 'a_1', sessionId: 'sess', harness: 'claude-code', role: 'subagent', parentToolUseId: 'tu_spawn' });
  const tree = buildTree([{ transcript: main, file: 'main.json' }, { transcript: sub, file: 'agent-a_1.json' }]);
  expect(tree).toHaveLength(1);
  expect(tree[0].transcriptId).toBe('sess');
  expect(tree[0].children.map((c) => c.transcriptId)).toEqual(['a_1']);
});

it('a self-loop link (parentToolUseId == own tool id) degrades to a root, never hidden (inspect-gate guard)', () => {
  const mainFile = write([
    { type: 'assistant', requestId: 'm1', timestamp: 't', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tu_spawn', name: 'Agent', input: {} },
    ] } },
  ]);
  // The subagent's own inner tool (tu_self) is also written as its parentToolUseId — the live-path bug.
  const selfFile = write([
    { type: 'assistant', requestId: 's1', timestamp: 't', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tu_self', name: 'Read', input: {} },
    ] } },
  ]);
  const main = parseTranscript(mainFile, { transcriptId: 'sess', sessionId: 'sess', harness: 'claude-code', role: 'main' });
  const self = parseTranscript(selfFile, { transcriptId: 'a_self', sessionId: 'sess', harness: 'claude-code', role: 'subagent', parentToolUseId: 'tu_self' });
  const tree = buildTree([{ transcript: main, file: 'main.json' }, { transcript: self, file: 'agent-a_self.json' }]);
  const ids = tree.map((r) => r.transcriptId);
  expect(ids).toContain('sess');                 // main still a root
  expect(ids).toContain('a_self');               // self-loop rooted, not lost as its own child
  const selfNode = tree.find((r) => r.transcriptId === 'a_self');
  expect(selfNode?.children).toHaveLength(0);     // rooted node never nested under itself
});

it('a mutual cycle (A↔B parentToolUseId) leaves both as roots, none lost', () => {
  const aFile = write([
    { type: 'assistant', requestId: 'a', timestamp: 't', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tu_a', name: 'Read', input: {} },
    ] } },
  ]);
  const bFile = write([
    { type: 'assistant', requestId: 'b', timestamp: 't', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tu_b', name: 'Read', input: {} },
    ] } },
  ]);
  // A's parent is a tool B emits; B's parent is a tool A emits — a 2-cycle.
  const a = parseTranscript(aFile, { transcriptId: 'a_A', sessionId: 'sess', harness: 'claude-code', role: 'subagent', parentToolUseId: 'tu_b' });
  const b = parseTranscript(bFile, { transcriptId: 'a_B', sessionId: 'sess', harness: 'claude-code', role: 'subagent', parentToolUseId: 'tu_a' });
  const tree = buildTree([{ transcript: a, file: 'agent-a_A.json' }, { transcript: b, file: 'agent-a_B.json' }]);
  const ids = tree.map((r) => r.transcriptId);
  expect(tree).toHaveLength(2);
  expect(ids).toContain('a_A');
  expect(ids).toContain('a_B');
});
