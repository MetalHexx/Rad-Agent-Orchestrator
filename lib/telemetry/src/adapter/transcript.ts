import fs from 'node:fs';
import path from 'node:path';

export interface RawUsage {
  input_tokens?: number; output_tokens?: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  // Claude Code splits cache-creation by TTL. `cache_creation_input_tokens` is the
  // total (5m + 1h); the nested object carries the breakdown. We keep the total on the
  // record and lift the 1h portion so the read side can price it at the 1h write rate
  // (Claude Code caches its stable prefix for 1h — the flat field alone loses that).
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}
export interface RawLine {
  type?: string; isSidechain?: boolean; requestId?: string; timestamp?: string;
  message?: { id?: string; model?: string; usage?: RawUsage };
}

export function readJsonl(file: string): RawLine[] {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out: RawLine[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as RawLine); } catch { /* skip a partial/garbled line */ }
  }
  return out;
}

// Subagent transcripts live under <session-dir>/subagents/agent-<id>.jsonl, where
// <session-dir> is the main transcript path minus its `.jsonl` extension. All Claude
// path knowledge stays here; path.join keeps separators OS-correct (NFR-6).
export function subagentPathFor(transcriptPath: string, agentId: string): string {
  const dir = path.dirname(transcriptPath);
  const base = path.basename(transcriptPath, '.jsonl');
  return path.join(dir, base, 'subagents', `agent-${agentId}.jsonl`);
}

export function listSubagentTranscripts(transcriptPath: string): string[] {
  const dir = path.join(path.dirname(transcriptPath), path.basename(transcriptPath, '.jsonl'), 'subagents');
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)); }
  catch { return []; }
}

// A subagent transcript (agent-<id>.jsonl) has a sibling identity sidecar
// agent-<id>.meta.json — { agentType, description, toolUseId } — written by Claude
// Code. It lets the SessionEnd backstop attribute subagent rows that arrive with no
// hook-supplied identity (PostToolUse already carries identity inline).
export function metaPathFor(subagentTranscript: string): string {
  const dir = path.dirname(subagentTranscript);
  const base = path.basename(subagentTranscript, '.jsonl');
  return path.join(dir, `${base}.meta.json`);
}

export interface SubagentMeta { agentType?: string; description?: string; toolUseId?: string }

export function readSubagentMeta(subagentTranscript: string): SubagentMeta {
  try {
    const raw = JSON.parse(fs.readFileSync(metaPathFor(subagentTranscript), 'utf8')) as Record<string, unknown>;
    return {
      agentType: typeof raw.agentType === 'string' ? raw.agentType : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      toolUseId: typeof raw.toolUseId === 'string' ? raw.toolUseId : undefined,
    };
  } catch { return {}; }                                   // missing / malformed ⇒ no identity, never throw
}

// Recover <id> from a `.../subagents/agent-<id>.jsonl` path (guards the prefix).
export function agentIdFromTranscript(subagentTranscript: string): string {
  const base = path.basename(subagentTranscript, '.jsonl');
  return base.startsWith('agent-') ? base.slice('agent-'.length) : '';
}
