import type { AgentNode } from '@rad-orchestration/telemetry';

export interface NavAgent {
  transcriptId: string;
  label: string;
  role: 'main' | 'subagent';
  agentType?: string;
  model?: string;
  startedAt?: string;
}

export function flattenAgentTree(nodes: AgentNode[]): NavAgent[] {
  const out: NavAgent[] = [];
  const walk = (ns: AgentNode[]) => ns.forEach((n) => {
    out.push({
      transcriptId: n.transcriptId,
      label: n.role === 'main' ? 'Main Agent' : (n.label ?? n.agentType ?? n.transcriptId),
      role: n.role,
      agentType: n.agentType,
      model: n.model?.length ? n.model.join(', ') : undefined,
      startedAt: n.startedAt,
    });
    if (n.children?.length) walk(n.children);
  });
  walk(nodes);
  // Strip order = strict chronological: main pinned first, then by startedAt ascending
  // (missing startedAt sorts last). ISO strings compare chronologically.
  const startKey = (a: NavAgent) => (a.role === 'main' ? '' : (a.startedAt ?? '￿'));
  out.sort((a, b) =>
    a.role === 'main' ? -1
      : b.role === 'main' ? 1
      : startKey(a) < startKey(b) ? -1
      : startKey(a) > startKey(b) ? 1
      : 0,
  );
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
