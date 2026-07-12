import type { TelemetryRecord } from '../types.js';

export interface ObservabilityUsageRow {
  sessionId: string;
  usageId: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  worktree?: string;
  // Identity fields un-stripped for per-model / -source / -agent attribution (AD-2).
  model: string;                          // always present on TelemetryRecord
  source: 'main-agent' | 'subagent';      // always present
  agentType?: string;                     // optional (present => a subagent row)
  agentId?: string;                       // optional — lifted top-level field; legacy rows fall back to pointers.agentId
  harness: string;                        // always present — attribution axis, independent of model/pricing
}

export function toObservabilityUsageRow(r: TelemetryRecord): ObservabilityUsageRow {
  const row: ObservabilityUsageRow = {
    sessionId: r.sessionId,
    usageId: r.usageId,
    timestamp: r.timestamp,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    model: r.model,
    source: r.source,
    harness: r.harness,
  };
  if (r.cacheReadTokens !== undefined) row.cacheReadTokens = r.cacheReadTokens;
  if (r.cacheCreationTokens !== undefined) row.cacheCreationTokens = r.cacheCreationTokens;
  if (r.worktree !== undefined) row.worktree = r.worktree;
  if (r.agentType !== undefined) row.agentType = r.agentType;
  const legacy = r.pointers as { agentId?: string } | undefined;
  const agentId = r.agentId ?? legacy?.agentId;
  if (agentId !== undefined) row.agentId = agentId;
  return row;
}
