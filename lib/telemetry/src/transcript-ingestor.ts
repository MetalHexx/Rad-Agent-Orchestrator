import fs from 'node:fs'; import path from 'node:path';
import type { HookEvent } from './types.js';
import { subagentPathFor, listSubagentTranscripts, readSubagentMeta, agentIdFromTranscript } from './adapter/transcript.js';
import { parseTranscript } from './transcript-parser.js';
import { buildTree } from './transcript-tree.js';
import type { AgentTranscript, TranscriptIndex } from './transcript-model.js';

export interface IngestDeps {
  root: string; signal: HookEvent; now: Date;
  log?: (msg: string, payload?: Record<string, unknown>) => void;
}

const HARNESS = 'claude-code';
function sessionDir(root: string, sessionId: string): string { return path.join(root, 'transcripts', sessionId); }
// One writer per file, last-write-wins (NFR-3); store stays under the sacred telemetry root (NFR-5).
function writeAgent(root: string, sessionId: string, file: string, t: AgentTranscript): void {
  const dir = sessionDir(root, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), JSON.stringify(t));
}

// Event-gated ingest (AD-2). Bodies are captured unredacted — acceptable for the local,
// single-user, sacred-folder setup; redaction is T-8 (NFR-6).
export function ingestTranscripts(deps: IngestDeps): void {
  const { root, signal } = deps;
  try {
    if (signal.event === 'PostToolUse') {
      if (!signal.agentId) return;                                   // regular tool — no transcript ingest (AD-2)
      const file = signal.agentTranscriptPath ?? subagentPathFor(signal.transcriptPath, signal.agentId);
      const t = parseTranscript(file, { transcriptId: signal.agentId, sessionId: signal.sessionId, harness: HARNESS, role: 'subagent', agentType: signal.agentType, parentToolUseId: signal.toolUseId });
      writeAgent(root, signal.sessionId, `agent-${signal.agentId}.json`, t);
      return;
    }
    // Stop / SessionEnd: (re)derive the main transcript — re-parsed whole each Stop (NFR-4).
    const main = parseTranscript(signal.transcriptPath, { transcriptId: signal.sessionId, sessionId: signal.sessionId, harness: HARNESS, role: 'main' });
    writeAgent(root, signal.sessionId, 'main.json', main);
    if (signal.event !== 'SessionEnd') return;
    // SessionEnd backstop: sweep every subagent transcript + rebuild the derived index (AD-3).
    const items: { transcript: AgentTranscript; file: string }[] = [{ transcript: main, file: 'main.json' }];
    for (const f of listSubagentTranscripts(signal.transcriptPath)) {
      const id = agentIdFromTranscript(f); if (!id) continue;
      const meta = readSubagentMeta(f);
      const t = parseTranscript(f, { transcriptId: id, sessionId: signal.sessionId, harness: HARNESS, role: 'subagent', agentType: meta.agentType, label: meta.description, parentToolUseId: meta.toolUseId });
      writeAgent(root, signal.sessionId, `agent-${id}.json`, t);
      items.push({ transcript: t, file: `agent-${id}.json` });
    }
    const index: TranscriptIndex = { sessionId: signal.sessionId, harness: HARNESS, createdAt: deps.now.toISOString(), tree: buildTree(items) };
    fs.writeFileSync(path.join(sessionDir(root, signal.sessionId), 'index.json'), JSON.stringify(index));
  } catch (e) {
    deps.log?.('transcript_ingest_failed', { event: signal.event, sessionId: signal.sessionId, error: e instanceof Error ? e.message : String(e) }); // never disturb the host (NFR-1, AD-5)
  }
}
