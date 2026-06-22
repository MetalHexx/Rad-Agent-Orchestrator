// Harness-agnostic normalized conversation model. Render-fidelity, not byte-fidelity:
// every consumer renders against these shapes; raw .jsonl knowledge stays in the parser.
export const EVENT_KINDS = [
  'message', 'thinking', 'tool_call', 'tool_result', 'system', 'hook', 'file_change',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface TruncatableBody { text: string; truncated?: true; fullBytes?: number; }

export interface TranscriptEvent {
  seq: number;
  timestamp: string;
  requestId?: string;                         // joins an event to a usage row
  kind: EventKind;
  role?: 'user' | 'assistant';
  text?: string;
  tool?: { name: string; input: TruncatableBody; toolUseId: string };
  result?: { toolUseId: string; output: TruncatableBody; isError: boolean };
  file?: { path: string; op: 'edit' | 'write' | 'snapshot' };
}

export interface TokenTotals { in: number; out: number; cacheRead: number; cacheCreate: number; }
export interface ToolSummary { total: number; byName: Record<string, number>; errors: number; }

export interface AgentTranscript {
  transcriptId: string;                       // == usage agentId; sessionId for main
  sessionId: string;
  harness: string;
  role: 'main' | 'subagent';
  agentType?: string;
  label?: string;
  parentToolUseId?: string;                   // == usage toolUseId (spawn edge)
  model: string[];
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  prompt?: string;
  result?: string;
  tokens: TokenTotals;
  toolSummary: ToolSummary;
  filesTouched: string[];
  events: TranscriptEvent[];
}

export interface AgentNode {
  transcriptId: string;
  role: 'main' | 'subagent';
  agentType?: string;
  label?: string;
  parentToolUseId?: string;
  model: string[];
  tokens: TokenTotals;
  toolSummary: ToolSummary;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  file: string;                               // 'main.json' | 'agent-<id>.json'
  children: AgentNode[];
}

export interface TranscriptIndex {
  sessionId: string; harness: string; createdAt: string; tree: AgentNode[];
}
