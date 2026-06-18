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
}

export function toObservabilityUsageRow(r: TelemetryRecord): ObservabilityUsageRow {
  const row: ObservabilityUsageRow = {
    sessionId: r.sessionId,
    usageId: r.usageId,
    timestamp: r.timestamp,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  };
  if (r.cacheReadTokens !== undefined) row.cacheReadTokens = r.cacheReadTokens;
  if (r.cacheCreationTokens !== undefined) row.cacheCreationTokens = r.cacheCreationTokens;
  if (r.worktree !== undefined) row.worktree = r.worktree;
  return row;
}
