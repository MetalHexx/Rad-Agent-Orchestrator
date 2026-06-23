import type { AgentNode } from '@rad-orchestration/telemetry';

export interface NavAgent {
  transcriptId: string;
  label: string;
  role: 'main' | 'subagent';
  agentType?: string;
  model?: string;
}

export function flattenAgentTree(nodes: AgentNode[]): NavAgent[] {
  const out: NavAgent[] = [];
  const walk = (ns: AgentNode[]) => ns.forEach((n) => {
    out.push({ transcriptId: n.transcriptId, label: n.label ?? n.agentType ?? n.transcriptId, role: n.role, agentType: n.agentType, model: n.model?.length ? n.model.join(', ') : undefined });
    if (n.children?.length) walk(n.children);
  });
  walk(nodes);
  return out;
}

export function siblingNav(list: NavAgent[], currentId: string): { prevId: string | null; nextId: string | null } {
  const i = list.findIndex((a) => a.transcriptId === currentId);
  return { prevId: i > 0 ? list[i - 1].transcriptId : null, nextId: i >= 0 && i < list.length - 1 ? list[i + 1].transcriptId : null };
}

export function availableTranscriptIds(nodes: AgentNode[]): Set<string> {
  const s = new Set<string>();
  const walk = (ns: AgentNode[]) => ns.forEach((n) => { s.add(n.transcriptId); if (n.children?.length) walk(n.children); });
  walk(nodes);
  return s;
}
