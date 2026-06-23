export const SCHEMA_VERSION = 2 as const;

export type OpKind =
  | 'requirements' | 'master_plan' | 'coding' | 'code_review'
  | 'phase_review' | 'final_review' | 'commit' | 'pr' | 'orchestration';

export interface OperationBlock {
  kind: OpKind; phase?: string; task?: string; attempt?: number; verdict?: string;
}

export interface TelemetryRecord {
  schemaVersion: number;
  harness: string;
  usageId: string;
  sessionId: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  serverToolUse?: Record<string, number>;
  toolCalls?: { total: number; byName?: Record<string, number>; errors?: number };
  agentType?: string;
  agentId?: string;                      // join key == transcript transcriptId (AD-7)
  toolUseId?: string;                    // spawn edge == transcript parentToolUseId (AD-7)
  worktree?: string;
  source: 'main-agent' | 'subagent';
  pointers: { sourceFile: string; requestId?: string };
  operation?: OperationBlock;            // DORMANT until TELEMETRY-4 (AD-9)
  extra?: Record<string, unknown>;
}

export interface CaptureSignal { sessionId: string; cwd: string; kind: string; }

export interface HookEvent extends CaptureSignal {
  event: 'PostToolUse' | 'SubagentStop' | 'Stop' | 'SessionEnd' | 'SubagentStart' | 'PreToolUse';
  transcriptPath: string;
  agentTranscriptPath?: string;
  toolName?: string;
  toolUseId?: string;
  agentId?: string;
  agentType?: string;
  meta?: { resolvedModel?: string; toolStats?: unknown; prompt?: string; response?: string };
}

export interface HarnessAdapter {
  readonly harness: string;
  identity(raw: unknown): string;
  capture(signal: CaptureSignal, seen: Set<string>): TelemetryRecord[];
}

export interface TelemetrySink { write(records: TelemetryRecord[]): void; }

export interface CheckpointStore {
  seen(sessionId: string): Set<string>;
  commit(sessionId: string, ids: Set<string>): void;
  tryLock(sessionId: string): boolean;
  unlock(sessionId: string): void;
}

// Injected only from TELEMETRY-4; absent here => rows stay unattributed (AD-9).
export interface OperationEventStore {
  resolve(record: TelemetryRecord, signal: CaptureSignal): OperationBlock | undefined;
}
