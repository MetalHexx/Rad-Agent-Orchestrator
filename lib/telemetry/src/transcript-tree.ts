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
  const roots: AgentNode[] = [];
  for (const { node } of nodes) {
    const parent = node.parentToolUseId ? owner.get(node.parentToolUseId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}
