import fs from 'node:fs';
import path from 'node:path';

export interface RawUsage {
  input_tokens?: number; output_tokens?: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
}
export interface RawLine {
  type?: string; isSidechain?: boolean; requestId?: string; timestamp?: string;
  message?: { model?: string; usage?: RawUsage };
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
