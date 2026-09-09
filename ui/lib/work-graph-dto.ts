// ui/lib/work-graph-dto.ts
// Pure Node -> WorkGraphNodeDTO transform, lifted out of the route so it is
// importable — and testable — without pulling in `next/server`. Imports only
// types from '@rad-orchestration/work-graph' and '@/types/work-graph'.

import type { Node, Project } from '@rad-orchestration/work-graph';
import type { WorkGraphNodeDTO, WorkGraphTier } from '@/types/work-graph';

export const KNOWN_TIERS = new Set<string>(['planning', 'execution', 'review', 'halted', 'complete']);

export function toNodeDTO(node: Node): WorkGraphNodeDTO {
  if (node.kind === 'project') {
    const project = node as Project;
    const tier: WorkGraphTier | null = KNOWN_TIERS.has(project.tier ?? '')
      ? (project.tier as WorkGraphTier)
      : null;
    return {
      id: project.id,
      kind: 'project',
      name: project.name,
      tier,
      state: project.state,
      stateLabel: project.stateLabel,
      projectType: project.projectType,
    };
  }
  return { id: node.id, kind: 'group', name: node.name };
}
