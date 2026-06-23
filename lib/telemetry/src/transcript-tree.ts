import type { AgentNode, AgentTranscript } from './transcript-model.js';

export function toSummary(t: AgentTranscript, file: string): AgentNode {
  return {
    transcriptId: t.transcriptId, role: t.role, agentType: t.agentType, label: t.label,
    parentToolUseId: t.parentToolUseId, model: t.model, tokens: t.tokens, toolSummary: t.toolSummary,
    startedAt: t.startedAt, endedAt: t.endedAt, durationMs: t.durationMs, file, children: [],
  };
}

// Link each agent under the agent whose events emitted its spawning tool_use id.
// Handles arbitrary nesting; agents with no resolvable parent become roots.
export function buildTree(items: { transcript: AgentTranscript; file: string }[]): AgentNode[] {
  const nodes = items.map(({ transcript, file }) => ({
    node: toSummary(transcript, file),
    emits: new Set(transcript.events.filter((e) => e.kind === 'tool_call').map((e) => e.tool!.toolUseId)),
  }));
  const owner = new Map<string, AgentNode>();
  for (const { node, emits } of nodes) for (const id of emits) owner.set(id, node);
  const parentOf = (n: AgentNode): AgentNode | undefined =>
    n.parentToolUseId ? owner.get(n.parentToolUseId) : undefined;
  // Nest only when walking up from the prospective parent never returns to the node:
  // guards a self-loop (parentToolUseId == the node's OWN tool id) or any cycle, which would
  // otherwise make the node its own descendant and drop it from the root walk (the inspect gate).
  const wouldCycle = (parent: AgentNode, node: AgentNode): boolean => {
    const seen = new Set<AgentNode>();
    for (let cur: AgentNode | undefined = parent; cur; cur = parentOf(cur)) {
      if (cur === node) return true;
      if (seen.has(cur)) return false;   // pre-existing cycle not involving node
      seen.add(cur);
    }
    return false;
  };
  const roots: AgentNode[] = [];
  for (const { node } of nodes) {
    const parent = parentOf(node);
    (parent && !wouldCycle(parent, node) ? parent.children : roots).push(node);
  }
  return roots;
}
