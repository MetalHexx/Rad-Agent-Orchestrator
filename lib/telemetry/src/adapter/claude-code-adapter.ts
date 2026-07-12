import {
  SCHEMA_VERSION, type CaptureSignal, type HarnessAdapter, type HookEvent, type TelemetryRecord,
} from '../types.js';
import {
  readJsonl, subagentPathFor, listSubagentTranscripts,
  readSubagentMeta, agentIdFromTranscript, type RawLine,
} from './transcript.js';

export { subagentPathFor } from './transcript.js';

export function worktreeFromCwd(cwd?: string): string | undefined {
  return cwd?.trim() ? cwd : undefined;
}

type Source = 'main-agent' | 'subagent';

// Subagent attribution resolved from the .meta.json sidecar (SessionEnd backstop),
// where the hook carries no inline identity. Undefined for PostToolUse, which
// already supplies identity on the event (ev.agentId/agentType/toolUseId).
interface SubagentIdentity { agentId?: string; agentType?: string; toolUseId?: string }

export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly harness = 'claude-code';

  identity(raw: unknown): string { return String((raw as RawLine).requestId ?? ''); }

  capture(signal: CaptureSignal, seen: Set<string>): TelemetryRecord[] {
    const ev = signal as HookEvent;
    const byKey = new Map<string, { line: RawLine; file: string; source: Source; identity?: SubagentIdentity; lines: number }>();
    for (const { file, source, identity } of this.sourcesFor(ev)) {
      for (const line of readJsonl(file)) {
        if (line.type !== 'assistant' || (source !== 'subagent' && line.isSidechain)) continue; // skip sidechain only in the main sweep; subagent transcripts are entirely sidechain (FR-3)
        if (!line.message?.usage || !line.requestId) continue;
        const id = this.identity(line);
        const prev = byKey.get(id);
        // output_tokens grows across a request's streamed lines; take the max/final
        // (>= keeps the later line on a tie, so the terminal line's cache_creation wins)
        // rather than merely last-wins, so a lower late line can never demote the total.
        if (!prev) {
          byKey.set(id, { line, file, source, identity, lines: 1 });
        } else {
          prev.lines += 1;
          if ((line.message.usage.output_tokens ?? 0) >= (prev.line.message!.usage!.output_tokens ?? 0)) {
            Object.assign(prev, { line, file, source, identity });
          }
        }
      }
    }
    // Emit un-seen requests, plus already-seen requests that streamed across more than one
    // line here: those are the only ones whose persisted value could still be a mid-stream
    // partial committed in an earlier hook invocation. Re-emitting them with the corrected
    // max lets the read-side last-wins dedupe (usage-reader) resolve to the final output. A
    // single-line seen request is already final — skipping it keeps the sweep idempotent.
    const records: TelemetryRecord[] = [];
    for (const [id, v] of byKey) {
      if (seen.has(id) && v.lines < 2) continue;
      records.push(this.toRecord(ev, v.line, v.file, v.source, v.identity));
    }
    return records;
  }

  private sourcesFor(ev: HookEvent): { file: string; source: Source; identity?: SubagentIdentity }[] {
    if (ev.event === 'PostToolUse' && ev.agentId) {
      // PostToolUse usually carries identity inline on the event (the live, per-op-accurate
      // path). But some payloads arrive with agentId set and agentType/toolUseId empty, which
      // would write a typeless subagent row. Backfill the gap from the agent-<id>.meta.json
      // sidecar (the same source SessionEnd uses); ev.* still wins when present.
      const file = ev.agentTranscriptPath ?? subagentPathFor(ev.transcriptPath, ev.agentId);
      const meta = (!ev.agentType || !ev.toolUseId) ? readSubagentMeta(file) : {};
      return [{
        file,
        source: 'subagent',
        identity: {
          agentId: ev.agentId,
          agentType: ev.agentType ?? meta.agentType,
          toolUseId: ev.toolUseId ?? meta.toolUseId,
        },
      }];
    }
    if (ev.event === 'SessionEnd') {
      // The session-close backstop has no inline identity; recover it from each
      // subagent transcript's filename (agentId) + its .meta.json sidecar.
      return [
        { file: ev.transcriptPath, source: 'main-agent' as Source },
        ...listSubagentTranscripts(ev.transcriptPath).map((f) => {
          const meta = readSubagentMeta(f);
          return {
            file: f,
            source: 'subagent' as Source,
            identity: { agentId: agentIdFromTranscript(f), agentType: meta.agentType, toolUseId: meta.toolUseId },
          };
        }),
      ];
    }
    return [{ file: ev.transcriptPath, source: 'main-agent' }]; // Stop (live main-agent turn)
  }

  private toRecord(ev: HookEvent, line: RawLine, file: string, source: Source, identity?: SubagentIdentity): TelemetryRecord {
    const u = line.message!.usage!;
    // Subagent attribution: prefer the resolved identity (SessionEnd sidecar),
    // else the inline event fields (PostToolUse). Main-agent rows carry none.
    const agentType = source === 'subagent' ? (identity?.agentType ?? ev.agentType) : undefined;
    const agentId = source === 'subagent' ? (identity?.agentId ?? ev.agentId) : undefined;
    const toolUseId = source === 'subagent' ? (identity?.toolUseId ?? ev.toolUseId) : undefined;
    return {
      schemaVersion: SCHEMA_VERSION,
      harness: this.harness,
      usageId: this.identity(line),
      sessionId: ev.sessionId,
      timestamp: line.timestamp ?? new Date().toISOString(),
      model: line.message?.model ?? 'unknown',
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens,
      cacheCreationTokens: u.cache_creation_input_tokens,
      // 1h-TTL subset of the cache-write total; undefined when the harness omits the
      // nested breakdown (older transcripts), which the read side treats as all-5m.
      cacheCreation1hTokens: u.cache_creation?.ephemeral_1h_input_tokens,
      agentType, agentId, toolUseId,
      worktree: worktreeFromCwd(ev.cwd),
      source,
      pointers: { sourceFile: file, requestId: this.identity(line) },
      // operation intentionally omitted — dormant until TELEMETRY-4 (AD-9).
    };
  }
}
