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
    const byKey = new Map<string, { line: RawLine; file: string; source: Source; identity?: SubagentIdentity }>();
    for (const { file, source, identity } of this.sourcesFor(ev)) {
      for (const line of readJsonl(file)) {
        if (line.type !== 'assistant' || (source !== 'subagent' && line.isSidechain)) continue; // skip sidechain only in the main sweep; subagent transcripts are entirely sidechain (FR-3)
        if (!line.message?.usage || !line.requestId) continue;
        const id = this.identity(line);
        if (seen.has(id)) continue;
        byKey.set(id, { line, file, source, identity }); // last line per usageId wins — the complete one (FR-3)
      }
    }
    return [...byKey.values()].map(({ line, file, source, identity }) => this.toRecord(ev, line, file, source, identity));
  }

  private sourcesFor(ev: HookEvent): { file: string; source: Source; identity?: SubagentIdentity }[] {
    if (ev.event === 'PostToolUse' && ev.agentId) {
      // PostToolUse carries identity inline on the event — leave identity undefined
      // so toRecord reads ev.* (the live, per-op-accurate path).
      return [{ file: ev.agentTranscriptPath ?? subagentPathFor(ev.transcriptPath, ev.agentId), source: 'subagent' }];
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
      agentType, agentId, toolUseId,
      worktree: worktreeFromCwd(ev.cwd),
      source,
      pointers: { sourceFile: file, requestId: this.identity(line) },
      // operation intentionally omitted — dormant until TELEMETRY-4 (AD-9).
    };
  }
}
