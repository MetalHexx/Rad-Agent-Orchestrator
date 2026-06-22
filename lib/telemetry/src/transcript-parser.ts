import { readJsonl } from './adapter/transcript.js';
import type { TranscriptEvent, TruncatableBody } from './transcript-model.js';

const BODY_MAX_BYTES = 16 * 1024;
const BODY_MAX_LINES = 200;

export function truncateBody(raw: unknown): TruncatableBody {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  const lines = text.split('\n');
  const overLines = lines.length > BODY_MAX_LINES;
  const head = overLines ? lines.slice(0, BODY_MAX_LINES).join('\n') : text;
  if (!overLines && head.length <= BODY_MAX_BYTES) return { text };
  return { text: head.slice(0, BODY_MAX_BYTES), truncated: true, fullBytes: Buffer.byteLength(text, 'utf8') };
}

interface RawBlock {
  type?: string; text?: string; thinking?: string;
  id?: string; name?: string; input?: unknown;
  tool_use_id?: string; content?: unknown; is_error?: boolean;
}
interface RawTLine {
  type?: string; requestId?: string; timestamp?: string;
  message?: { role?: string; model?: string; content?: string | RawBlock[]; usage?: Record<string, number> };
}

// Selective by design (AD-5): only the modeled shapes emit events; unmodeled lines/blocks
// are skipped silently. readJsonl already swallows malformed lines, so this never throws.
export function eventsFromRaw(raw: RawTLine[]): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  let seq = 0;
  for (const r of raw) {
    const role = r.type === 'user' ? 'user' : r.type === 'assistant' ? 'assistant' : undefined;
    if (!role || !r.message) continue;                          // unmodeled line — skip
    const ts = r.timestamp ?? '';
    const blocks: RawBlock[] = typeof r.message.content === 'string'
      ? [{ type: 'text', text: r.message.content }]
      : Array.isArray(r.message.content) ? r.message.content : [];
    for (const b of blocks) {
      if (b.type === 'text' && b.text) {
        events.push({ seq: seq++, timestamp: ts, requestId: r.requestId, kind: 'message', role, text: b.text });
      } else if (b.type === 'thinking' && b.thinking) {
        events.push({ seq: seq++, timestamp: ts, requestId: r.requestId, kind: 'thinking', role, text: b.thinking });
      } else if (b.type === 'tool_use' && b.id && b.name) {
        events.push({ seq: seq++, timestamp: ts, requestId: r.requestId, kind: 'tool_call', tool: { name: b.name, input: truncateBody(b.input), toolUseId: b.id } });
        const op = b.name === 'Edit' ? 'edit' : b.name === 'Write' ? 'write' : undefined;
        const fpath = (b.input as { file_path?: string } | undefined)?.file_path;
        if (op && fpath) events.push({ seq: seq++, timestamp: ts, requestId: r.requestId, kind: 'file_change', file: { path: fpath, op } });
      } else if (b.type === 'tool_result' && b.tool_use_id) {
        events.push({ seq: seq++, timestamp: ts, requestId: r.requestId, kind: 'tool_result', result: { toolUseId: b.tool_use_id, output: truncateBody(b.content), isError: Boolean(b.is_error) } });
      }
      // any other block type: skipped silently (AD-5)
    }
  }
  return events;
}

export function parseEvents(file: string): TranscriptEvent[] {
  return eventsFromRaw(readJsonl(file) as unknown as RawTLine[]);
}
