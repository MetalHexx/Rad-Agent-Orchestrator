import type { AgentTreeNode, SubagentTree } from './subagent-tree';
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

/** transcriptId → display label, sourced from the breakdown table (authoritative numbering).
 *  Lets the modal show the SAME 'coder 1' / 'Main Agent' labels as the table, keyed by id. */
export function numberedAgentLabels(tree: SubagentTree, sessionId: string): Map<string, string> {
  const m = new Map<string, string>();
  m.set(sessionId, 'Main Agent');                          // main → sessionId key
  for (const g of tree.subagents) {
    if (g.runCount > 1) {
      for (const r of g.runs ?? []) m.set(r.key, r.label); // r.key = runId = transcriptId; r.label = 'coder 1'
    } else {
      const r = g.runs?.[0];
      if (r) m.set(r.key, g.label);                        // single-run leaf → agentType label (unnumbered)
    }
  }
  return m;
}
