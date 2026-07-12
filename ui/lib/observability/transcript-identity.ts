import type { AgentTreeNode, SubagentTree } from './subagent-tree';
export type RowVariant = 'main' | 'subagent';

/** Map a Breakdown row to its transcript id. main → sessionId; subagent → node.key (the runId). */
export function rowTranscriptId(node: AgentTreeNode, variant: RowVariant, sessionId: string): string | null {
  return variant === 'main' ? sessionId : node.key;
}
export function isInspectable(transcriptId: string | null, availableIds: Set<string>): boolean {
  return !!transcriptId && availableIds.has(transcriptId);
}

/** transcriptId → display label, sourced from the breakdown table (authoritative numbering).
 *  Lets the modal show the SAME 'coder 1' / 'Main Agent' labels as the table, keyed by id. */
export function numberedAgentLabels(tree: SubagentTree, sessionId: string): Map<string, string> {
  const m = new Map<string, string>();
  m.set(sessionId, 'Main Agent');                          // main → sessionId key
  for (const r of tree.subagents) m.set(r.key, r.label);   // r.key = runId = transcriptId; r.label = bare type
  return m;
}
