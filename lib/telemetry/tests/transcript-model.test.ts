import { it, expect } from 'vitest';
import { EVENT_KINDS, type AgentTranscript, type AgentNode } from '../src/transcript-model.js';

it('models the seven normalized event kinds in order (DD-1)', () => {
  expect([...EVENT_KINDS]).toEqual(
    ['message', 'thinking', 'tool_call', 'tool_result', 'system', 'hook', 'file_change'],
  );
});

it('AgentTranscript and AgentNode carry the join keys and derived fields (FR-2, DD-2)', () => {
  const t: AgentTranscript = {
    transcriptId: 's1', sessionId: 's1', harness: 'claude-code', role: 'main', model: ['m'],
    tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
    toolSummary: { total: 0, byName: {}, errors: 0 }, filesTouched: [], events: [],
  };
  const n: AgentNode = {
    transcriptId: 's1', role: 'main', model: ['m'], tokens: t.tokens,
    toolSummary: t.toolSummary, file: 'main.json', children: [],
  };
  expect(t.transcriptId).toBe(n.transcriptId);
});
