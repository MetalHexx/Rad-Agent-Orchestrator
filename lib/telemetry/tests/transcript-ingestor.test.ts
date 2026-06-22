import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { ingestTranscripts } from '../src/transcript-ingestor.js';
import type { HookEvent } from '../src/types.js';

function writeTx(lines: unknown[], file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
}
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ing-')); }

it('PostToolUse[Agent] writes the subagent file once and is idempotent on re-ingest (FR-1, AD-2, NFR-3)', () => {
  const root = tmp(); const home = tmp();
  const main = path.join(home, 'session-x.jsonl');
  const sub = path.join(home, 'session-x', 'subagents', 'agent-a1.jsonl');
  writeTx([{ type: 'user', requestId: 'r', timestamp: 't', message: { role: 'user', content: 'go' } }], sub);
  const sig: HookEvent = { sessionId: 'sX', cwd: '.', kind: 'PostToolUse', event: 'PostToolUse', transcriptPath: main, agentId: 'a1', agentType: 'coder', toolUseId: 'tu_1' };
  ingestTranscripts({ root, signal: sig, now: new Date('2026-06-20T00:00:00Z') });
  ingestTranscripts({ root, signal: sig, now: new Date('2026-06-20T00:00:00Z') });
  const dir = path.join(root, 'transcripts', 'sX');
  expect(fs.readdirSync(dir)).toEqual(['agent-a1.json']);
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'agent-a1.json'), 'utf8'));
  expect(t.transcriptId).toBe('a1'); expect(t.parentToolUseId).toBe('tu_1'); expect(t.role).toBe('subagent');
});

it('SessionEnd writes main.json and a derived index.json tree, and never throws on a bad path (AD-3, NFR-1)', () => {
  const root = tmp(); const home = tmp();
  const main = path.join(home, 'session-y.jsonl');
  writeTx([
    { type: 'assistant', requestId: 'm', timestamp: 't', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_s', name: 'Agent', input: {} }] } },
  ], main);
  writeTx([{ type: 'user', requestId: 's', timestamp: 't', message: { role: 'user', content: 'sub' } }], path.join(home, 'session-y', 'subagents', 'agent-b2.jsonl'));
  fs.writeFileSync(path.join(home, 'session-y', 'subagents', 'agent-b2.meta.json'), JSON.stringify({ agentType: 'reviewer', description: 'review it', toolUseId: 'tu_s' }));
  const sig: HookEvent = { sessionId: 'sY', cwd: '.', kind: 'SessionEnd', event: 'SessionEnd', transcriptPath: main };
  ingestTranscripts({ root, signal: sig, now: new Date('2026-06-20T00:00:00Z') });
  const dir = path.join(root, 'transcripts', 'sY');
  expect(fs.existsSync(path.join(dir, 'main.json'))).toBe(true);
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  expect(index.tree).toHaveLength(1);
  expect(index.tree[0].children[0].transcriptId).toBe('b2');
  expect(index.tree[0].children[0].label).toBe('review it');
  // host-safety: a bogus transcript path must not throw
  expect(() => ingestTranscripts({ root, signal: { ...sig, sessionId: 'sZ', transcriptPath: '/nope.jsonl' }, now: new Date('2026-06-20T00:00:00Z') })).not.toThrow();
});

it('PostToolUse[Agent] honors an explicit agentTranscriptPath override (AD-2)', () => {
  const root = tmp(); const home = tmp();
  const main = path.join(home, 'session-o.jsonl');
  const override = path.join(home, 'custom', 'override-a3.jsonl');
  writeTx([{ type: 'user', requestId: 'r', timestamp: 't', message: { role: 'user', content: 'override-marker' } }], override);
  const sig: HookEvent = { sessionId: 'sO', cwd: '.', kind: 'PostToolUse', event: 'PostToolUse', transcriptPath: main, agentTranscriptPath: override, agentId: 'a3', agentType: 'coder', toolUseId: 'tu_3' };
  ingestTranscripts({ root, signal: sig, now: new Date('2026-06-20T00:00:00Z') });
  const t = JSON.parse(fs.readFileSync(path.join(root, 'transcripts', 'sO', 'agent-a3.json'), 'utf8'));
  expect(t.prompt).toBe('override-marker');
});

it('Stop writes main.json from the main transcript and no index.json (AD-3, NFR-4)', () => {
  const root = tmp(); const home = tmp();
  const main = path.join(home, 'session-s.jsonl');
  writeTx([{ type: 'assistant', requestId: 'm', timestamp: 't', message: { role: 'assistant', content: 'done' } }], main);
  const sig: HookEvent = { sessionId: 'sS', cwd: '.', kind: 'Stop', event: 'Stop', transcriptPath: main };
  ingestTranscripts({ root, signal: sig, now: new Date('2026-06-20T00:00:00Z') });
  const dir = path.join(root, 'transcripts', 'sS');
  expect(fs.existsSync(path.join(dir, 'main.json'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'index.json'))).toBe(false);
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'main.json'), 'utf8'));
  expect(t.role).toBe('main'); expect(t.result).toBe('done');
});
