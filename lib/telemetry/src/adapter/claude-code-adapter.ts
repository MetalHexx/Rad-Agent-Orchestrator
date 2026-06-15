import {
  SCHEMA_VERSION, type CaptureSignal, type HarnessAdapter, type HookEvent, type TelemetryRecord,
} from '../types.js';
import { readJsonl, subagentPathFor, listSubagentTranscripts, type RawLine } from './transcript.js';

export { subagentPathFor } from './transcript.js';

type Source = 'main-agent' | 'subagent';

export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly harness = 'claude-code';

  identity(raw: unknown): string { return String((raw as RawLine).requestId ?? ''); }

  capture(signal: CaptureSignal, seen: Set<string>): TelemetryRecord[] {
    const ev = signal as HookEvent;
    const byKey = new Map<string, { line: RawLine; file: string; source: Source }>();
    for (const { file, source } of this.sourcesFor(ev)) {
      for (const line of readJsonl(file)) {
        if (line.type !== 'assistant' || line.isSidechain) continue; // defensive: never sum sidechain rows (FR-3)
        if (!line.message?.usage || !line.requestId) continue;
        const id = this.identity(line);
        if (seen.has(id)) continue;
        byKey.set(id, { line, file, source }); // last line per radOrcId wins — the complete one (FR-3)
      }
    }
    return [...byKey.values()].map(({ line, file, source }) => this.toRecord(ev, line, file, source));
  }

  private sourcesFor(ev: HookEvent): { file: string; source: Source }[] {
    if (ev.event === 'PostToolUse' && ev.agentId) {
      return [{ file: ev.agentTranscriptPath ?? subagentPathFor(ev.transcriptPath, ev.agentId), source: 'subagent' }];
    }
    if (ev.event === 'SessionEnd') {
      return [
        { file: ev.transcriptPath, source: 'main-agent' as Source },
        ...listSubagentTranscripts(ev.transcriptPath).map((f) => ({ file: f, source: 'subagent' as Source })),
      ];
    }
    return [{ file: ev.transcriptPath, source: 'main-agent' }]; // Stop (live main-agent turn)
  }

  private toRecord(ev: HookEvent, line: RawLine, file: string, source: Source): TelemetryRecord {
    const u = line.message!.usage!;
    return {
      schemaVersion: SCHEMA_VERSION,
      harness: this.harness,
      radOrcId: this.identity(line),
      sessionId: ev.sessionId,
      timestamp: line.timestamp ?? new Date().toISOString(),
      model: line.message?.model ?? 'unknown',
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens,
      cacheCreationTokens: u.cache_creation_input_tokens,
      agentType: source === 'subagent' ? ev.agentType : undefined,
      source,
      pointers: {
        sourceFile: file,
        requestId: this.identity(line),
        agentId: source === 'subagent' ? ev.agentId : undefined,
        toolUseId: source === 'subagent' ? ev.toolUseId : undefined,
      },
      // operation intentionally omitted — dormant until TELEMETRY-4 (AD-9).
    };
  }
}
