import type { AgentTreeNode } from './subagent-tree';
export type RowVariant = 'main' | 'group' | 'run' | 'leaf';

/** Map a Breakdown row to its transcript id. main → sessionId; run → node.key (the runId);
 *  single-run leaf → node.runs[0].key (leafFrom overwrites the row key with the agentType,
 *  so the run id must come from the underlying run); group rows are not inspectable. */
export function rowTranscriptId(node: AgentTreeNode, variant: RowVariant, sessionId: string): string | null {
  if (variant === 'main') return sessionId;
  if (variant === 'run') return node.key;
  if (variant === 'leaf') return node.runs?.[0]?.key ?? node.key;
  return null; // group
}
export function isInspectable(transcriptId: string | null, availableIds: Set<string>): boolean {
  return !!transcriptId && availableIds.has(transcriptId);
}
