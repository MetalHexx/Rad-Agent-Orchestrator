import fs from 'node:fs'; import path from 'node:path';
import type { AgentNode, AgentTranscript } from '../transcript-model.js';
import { buildTree } from '../transcript-tree.js';

function sessionDir(root: string, sessionId: string): string { return path.join(root, 'transcripts', sessionId); }
function readAgent(dir: string, file: string): AgentTranscript | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as AgentTranscript; }
  catch { return undefined; }                                    // absent/malformed => skip, never throw
}

// Tree is derived each call from the per-agent files (AD-3) — no dependency on a
// concurrently-written index, so finished agents appear immediately during a run.
export function listSessionAgents(root: string, sessionId: string): AgentNode[] {
  const dir = sessionDir(root, sessionId);
  let files: string[]; try { files = fs.readdirSync(dir); } catch { return []; }
  const items: { transcript: AgentTranscript; file: string }[] = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const t = readAgent(dir, f); if (t) items.push({ transcript: t, file: f });
  }
  return buildTree(items);
}

// The full transcript (events included). Main resolves by sessionId; subagents by agentId (AD-7).
export function getAgentTranscript(root: string, sessionId: string, transcriptId: string): AgentTranscript | undefined {
  const file = transcriptId === sessionId ? 'main.json' : `agent-${transcriptId}.json`;
  return readAgent(sessionDir(root, sessionId), file);
}
