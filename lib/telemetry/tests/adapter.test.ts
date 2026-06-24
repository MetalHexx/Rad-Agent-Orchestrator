import { describe, it, expect } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeAdapter, subagentPathFor } from '../src/adapter/claude-code-adapter.js';
import type { HookEvent } from '../src/types.js';

// ESM module ("type": "module") — __dirname is undefined, so resolve checked-in
// fixtures relative to import.meta.url (NFR-5: fixture-backed adapter coverage).
const MAIN_FIXTURE = fileURLToPath(new URL('./fixtures/main-session.jsonl', import.meta.url));
const SUBAGENT_ID = 'a0d327';
const SUBAGENT_FIXTURE = subagentPathFor(MAIN_FIXTURE, SUBAGENT_ID);

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
  it('emits one record per usageId keeping the final line, excluding sidechain and usage-less rows — fixture-backed (FR-3, NFR-5)', () => {
    const signal: HookEvent = { sessionId: 's1', cwd: '.', kind: 'Stop', event: 'Stop', transcriptPath: MAIN_FIXTURE };
    const records = new ClaudeCodeAdapter().capture(signal, new Set());

    // Two distinct surviving usageIds: req_main_1 (deduped, final wins) + req_main_2.
    // req_sidechain (isSidechain) and req_no_usage (no message.usage) are excluded.
    const byId = new Map(records.map((r) => [r.usageId, r]));
    expect([...byId.keys()].sort()).toEqual(['req_main_1', 'req_main_2']);

    const main1 = byId.get('req_main_1')!;
    expect(main1.outputTokens).toBe(98);             // final line wins, not the intermediate 3 (FR-3)
    expect(main1.cacheReadTokens).toBe(10);
    expect(main1.cacheCreationTokens).toBe(4);       // only present on the final line
    expect(main1.source).toBe('main-agent');

    expect(records.some((r) => r.usageId === 'req_sidechain')).toBe(false); // isSidechain excluded (FR-3)
    expect(records.some((r) => r.usageId === 'req_no_usage')).toBe(false);  // no usage excluded (FR-3)
  });

  it('computes usageId = requestId, emits lean pointers, and leaves operation dormant (AD-2, NFR-8, AD-9)', () => {
    const file = writeTranscript([asst('req_x', 7)]);
    const signal: HookEvent = { sessionId: 's1', cwd: '.', kind: 'Stop', event: 'Stop', transcriptPath: file };
    const [r] = new ClaudeCodeAdapter().capture(signal, new Set());
    expect(r.usageId).toBe('req_x');
    expect(r.pointers.requestId).toBe('req_x');
    expect(r.pointers.sourceFile).toBe(file);
    expect(r.operation).toBeUndefined();             // dormant (AD-9)
    expect('prompt' in r || 'response' in r).toBe(false); // no bodies (NFR-8)
  });

  it('skips usageIds already in the checkpoint seen-set (FR-3)', () => {
    const signal: HookEvent = { sessionId: 's1', cwd: '.', kind: 'Stop', event: 'Stop', transcriptPath: MAIN_FIXTURE };
    const records = new ClaudeCodeAdapter().capture(signal, new Set(['req_main_1']));
    // req_main_1 was pre-seen, so only req_main_2 survives.
    expect(records.map((r) => r.usageId)).toEqual(['req_main_2']);
  });

  it('SessionEnd unions distinct main + subagent usageIds with disjoint per-source tagging — fixture-backed (FR-3, NFR-5)', () => {
    const signal: HookEvent = {
      sessionId: 's1', cwd: '.', kind: 'SessionEnd', event: 'SessionEnd', transcriptPath: MAIN_FIXTURE,
    };
    const records = new ClaudeCodeAdapter().capture(signal, new Set());
    const byId = new Map(records.map((r) => [r.usageId, r]));

    // Disjoint union: main fixture contributes req_main_1 + req_main_2, the
    // discovered subagent transcript contributes req_sub_1 + req_sub_2.
    expect([...byId.keys()].sort()).toEqual(['req_main_1', 'req_main_2', 'req_sub_1', 'req_sub_2']);

    expect(byId.get('req_main_1')!.source).toBe('main-agent');
    expect(byId.get('req_main_2')!.source).toBe('main-agent');
    expect(byId.get('req_sub_1')!.source).toBe('subagent');
    expect(byId.get('req_sub_2')!.source).toBe('subagent');

    // Sums are disjoint: no requestId is shared across the two sources.
    const mainIds = records.filter((r) => r.source === 'main-agent').map((r) => r.usageId);
    const subIds = records.filter((r) => r.source === 'subagent').map((r) => r.usageId);
    expect(mainIds.some((id) => subIds.includes(id))).toBe(false);

    // Subagent rows are read from the path the transcript helpers derive.
    const subRecord = byId.get('req_sub_1')!;
    expect(subRecord.pointers.sourceFile).toBe(SUBAGENT_FIXTURE);
    // SessionEnd carries no inline identity — rows are de-anonymized from the
    // filename (agentId) and the agent-<id>.meta.json sidecar (agentType, toolUseId).
    expect(subRecord.agentType).toBe('coder');
    expect(subRecord.agentId).toBe(SUBAGENT_ID);
    expect(subRecord.toolUseId).toBe('toolu_sub_a0d327');
    expect(byId.get('req_sub_2')!.agentId).toBe(SUBAGENT_ID);
  });

  it('SessionEnd still attributes subagent rows by filename when the .meta.json sidecar is missing (FR-3)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-nometa-'));
    const main = path.join(dir, 'session-z.jsonl');
    fs.writeFileSync(main, JSON.stringify(asst('req_main_z', 7)) + '\n', 'utf8');
    const subDir = path.join(dir, 'session-z', 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    // Subagent transcript present, but NO agent-deadbeef.meta.json next to it.
    fs.writeFileSync(path.join(subDir, 'agent-deadbeef.jsonl'), JSON.stringify(asst('req_sub_z', 9)) + '\n', 'utf8');

    const signal: HookEvent = { sessionId: 's1', cwd: '.', kind: 'SessionEnd', event: 'SessionEnd', transcriptPath: main };
    const records = new ClaudeCodeAdapter().capture(signal, new Set()); // must not throw
    const sub = records.find((r) => r.usageId === 'req_sub_z')!;
    expect(sub.source).toBe('subagent');
    expect(sub.agentId).toBe('deadbeef');                 // recovered from filename
    expect(sub.agentType).toBeUndefined();               // no sidecar ⇒ no type
    expect(sub.toolUseId).toBeUndefined();                // no sidecar ⇒ no toolUseId
  });

  it('PostToolUse with an agentId captures only the subagent transcript — fixture-backed (FR-3, NFR-5)', () => {
    const signal: HookEvent = {
      sessionId: 's1', cwd: '.', kind: 'PostToolUse', event: 'PostToolUse',
      transcriptPath: MAIN_FIXTURE, agentId: SUBAGENT_ID, agentType: 'coder', toolUseId: 'tu_1',
    };
    const records = new ClaudeCodeAdapter().capture(signal, new Set());

    // Only the subagent transcript is consulted — no main-agent rows leak in.
    expect(records.map((r) => r.usageId).sort()).toEqual(['req_sub_1', 'req_sub_2']);
    expect(records.every((r) => r.source === 'subagent')).toBe(true);
    expect(records.some((r) => r.usageId === 'req_main_1' || r.usageId === 'req_main_2')).toBe(false);

    const sub1 = records.find((r) => r.usageId === 'req_sub_1')!;
    expect(sub1.outputTokens).toBe(55);
    expect(sub1.agentType).toBe('coder');                 // subagent rows carry agentType (toRecord)
    expect(sub1.agentId).toBe(SUBAGENT_ID);
    expect(sub1.toolUseId).toBe('tu_1');
    // Assert against an independent literal suffix (not subagentPathFor, which the
    // adapter's PostToolUse branch itself calls) so the check can actually falsify.
    const expectedSuffix = path.join('fixtures', 'main-session', 'subagents', `agent-${SUBAGENT_ID}.jsonl`);
    expect(sub1.pointers.sourceFile.endsWith(expectedSuffix)).toBe(true);
  });

  it('PostToolUse backfills agentType/toolUseId from the .meta.json sidecar when the event omits them (FR-3)', () => {
    // Payload carries agentId but NO inline agentType/toolUseId — without the sidecar
    // backfill this would write a typeless subagent row (the "unattributed" slice).
    const signal: HookEvent = {
      sessionId: 's1', cwd: '.', kind: 'PostToolUse', event: 'PostToolUse',
      transcriptPath: MAIN_FIXTURE, agentId: SUBAGENT_ID,
    };
    const records = new ClaudeCodeAdapter().capture(signal, new Set());

    const sub1 = records.find((r) => r.usageId === 'req_sub_1')!;
    expect(sub1.source).toBe('subagent');
    expect(sub1.agentId).toBe(SUBAGENT_ID);
    expect(sub1.agentType).toBe('coder');                 // recovered from agent-a0d327.meta.json
    expect(sub1.toolUseId).toBe('toolu_sub_a0d327');      // recovered from the sidecar too
  });

  it('PostToolUse keeps inline identity when the event supplies it, even if a sidecar exists (FR-3)', () => {
    // ev.* wins over the sidecar — the sidecar is only a gap-filler.
    const signal: HookEvent = {
      sessionId: 's1', cwd: '.', kind: 'PostToolUse', event: 'PostToolUse',
      transcriptPath: MAIN_FIXTURE, agentId: SUBAGENT_ID, agentType: 'reviewer', toolUseId: 'tu_inline',
    };
    const sub1 = new ClaudeCodeAdapter().capture(signal, new Set()).find((r) => r.usageId === 'req_sub_1')!;
    expect(sub1.agentType).toBe('reviewer');              // inline value, not the sidecar's 'coder'
    expect(sub1.toolUseId).toBe('tu_inline');
  });

  it('derives the subagent transcript path with OS-correct separators (NFR-6)', () => {
    const main = path.join('C--dev', 'projects', 'slug', 'session-abc.jsonl');
    const expected = path.join('C--dev', 'projects', 'slug', 'session-abc', 'subagents', 'agent-a0d327.jsonl');
    expect(subagentPathFor(main, 'a0d327')).toBe(expected);
  });
});
