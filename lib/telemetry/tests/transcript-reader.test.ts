import { it, expect } from 'vitest';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { listSessionAgents, getAgentTranscript } from '../src/read/transcript-reader.js';

function seed(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdr-'));
  const dir = path.join(root, 'transcripts', 'sess'); fs.mkdirSync(dir, { recursive: true });
  const main = { transcriptId: 'sess', sessionId: 'sess', harness: 'claude-code', role: 'main', model: ['m'],
    tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 }, toolSummary: { total: 1, byName: { Agent: 1 }, errors: 0 },
    filesTouched: [], events: [{ seq: 0, timestamp: 't', kind: 'tool_call', tool: { name: 'Agent', input: { text: '' }, toolUseId: 'tu_s' } }] };
  const sub = { transcriptId: 'a_1', sessionId: 'sess', harness: 'claude-code', role: 'subagent', parentToolUseId: 'tu_s', model: ['m'],
    tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 }, toolSummary: { total: 0, byName: {}, errors: 0 }, filesTouched: [], events: [] };
  fs.writeFileSync(path.join(dir, 'main.json'), JSON.stringify(main));
  fs.writeFileSync(path.join(dir, 'agent-a_1.json'), JSON.stringify(sub));
  return root;
}

it('listSessionAgents derives the nested tree from per-agent files (FR-3, AD-3, DD-2)', () => {
  const tree = listSessionAgents(seed(), 'sess');
  expect(tree).toHaveLength(1);
  expect(tree[0].transcriptId).toBe('sess');
  expect(tree[0].children.map((c) => c.transcriptId)).toEqual(['a_1']);
  expect('events' in tree[0]).toBe(false);                       // summaries only (DD-2)
});

it('getAgentTranscript returns the full transcript with events; main resolves by sessionId (FR-7, DD-2)', () => {
  const root = seed();
  expect(getAgentTranscript(root, 'sess', 'sess')!.events).toHaveLength(1);
  expect(getAgentTranscript(root, 'sess', 'a_1')!.transcriptId).toBe('a_1');
  expect(getAgentTranscript(root, 'sess', 'missing')).toBeUndefined();
});
