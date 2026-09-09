// ui/lib/work-graph-view.ts
// Pure transform from a WorkGraphResponse into React Flow nodes/edges: group
// containers with their projects nested inside, relationship edges labeled with
// their raw type string, ungrouped projects collected into a synthetic container,
// and the keyword filter applied with one hop of relationship context around
// whatever survives the edge-type visibility filter.

import type { CSSProperties } from 'react';
import type {
  WorkGraphResponse, WorkGraphNodeDTO, WorkGraphProjectDTO, WorkGraphGroupDTO,
  WorkGraphFlowNode, WorkGraphFlowEdge,
  WorkGraphProjectData, WorkGraphContainerData,
  EdgeTypeKey,
} from '@/types/work-graph';

export const UNGROUPED_ID = '__ungrouped__';
export const UNGROUPED_LABEL = 'Ungrouped';

const ENABLED_EDGE_TYPE_TOKENS: readonly EdgeTypeKey[] = ['follows', 'depends-on', 'spawned-from', 'other'];

interface Container {
  id: string;
  label: string;
  synthetic: boolean;
  memberIds: string[];
}

/** Maps a raw edge type string to its legend/visibility row: the three named
 *  literals map to themselves, everything else (including invented types) is `'other'`. */
export function toEdgeTypeKey(type: string): EdgeTypeKey {
  return type === 'follows' || type === 'depends-on' || type === 'spawned-from' ? type : 'other';
}

/** The legend stroke colour for an edge-type row — shared by the canvas's own
 *  edge styling and the toolbar's legend swatches, so the two never drift.
 *  `other` intentionally reuses the decoration teal at reduced opacity rather
 *  than spending a new hue — unrecognised edge types default to the
 *  decoration category, so they render consistently with it. */
export function edgeTypeStrokeColor(key: EdgeTypeKey): string {
  switch (key) {
    case 'follows': return 'var(--color-link)';
    case 'depends-on': return 'var(--tier-halted)';
    case 'spawned-from': return 'var(--canvas-edge-decoration)';
    case 'other': return 'var(--canvas-edge-other)';
  }
}

/**
 * Resolves the `edges` URL query param into the enabled edge-type set.
 * Absent defaults to `['follows']`; an empty string means nothing is
 * enabled; unrecognised tokens are dropped rather than propagated, mirroring
 * how a malformed `start` value falls back instead of erroring.
 */
export function resolveEnabledEdgeTypes(raw: string | null): EdgeTypeKey[] {
  if (raw === null) return ['follows'];
  if (raw === '') return [];
  return raw
    .split(',')
    .filter((token): token is EdgeTypeKey => (ENABLED_EDGE_TYPE_TOKENS as readonly string[]).includes(token));
}

function getEdgeStyle(edgeType: string, ranking: boolean): CSSProperties {
  const strokeWidth = 1.5;
  const strokeDasharray = ranking ? undefined : '5,5';
  const key = toEdgeTypeKey(edgeType);
  const stroke = edgeTypeStrokeColor(key);

  const result: CSSProperties = { stroke, strokeWidth };
  if (strokeDasharray) result.strokeDasharray = strokeDasharray;
  return result;
}

function isProject(node: WorkGraphNodeDTO): node is WorkGraphProjectDTO {
  return node.kind === 'project';
}

function isGroup(node: WorkGraphNodeDTO): node is WorkGraphGroupDTO {
  return node.kind === 'group';
}

export function buildWorkGraphView(
  response: WorkGraphResponse,
  opts: {
    filter: string;
    /** The group id the viewer explicitly selected, or 'all'. A container named here is
     *  kept even when it has no visible members — see step 5. */
    scope: string;
    /** Relationship edges whose type resolves (via {@link toEdgeTypeKey}) to a key
     *  outside this set never enter the transform — see step 1. A hidden edge cannot
     *  rank the layout and cannot pull a neighbour in via the keyword filter's one-hop
     *  context (step 3), because it never survives to be considered by either. */
    enabledEdgeTypes: EdgeTypeKey[];
  },
): { nodes: WorkGraphFlowNode[]; edges: WorkGraphFlowEdge[] } {
  const nodesById = new Map(response.nodes.map(node => [node.id, node]));
  const projects = response.nodes.filter(isProject);
  const groups = response.nodes.filter(isGroup);

  // 1. Split containment (nesting) from relationships (drawn edges), then drop
  // any relationship whose type isn't enabled — before anything downstream
  // (ranking, one-hop keyword context) can see it.
  const containmentEdges = response.edges.filter(edge => edge.type === 'contains');
  const relationshipEdges = response.edges
    .filter(edge => edge.type !== 'contains')
    .filter(edge => opts.enabledEdgeTypes.includes(toEdgeTypeKey(edge.type)));

  // 2. parentOf — first edge wins; ignore containment edges whose `to` isn't a project.
  const parentOf = new Map<string, string>();
  for (const edge of containmentEdges) {
    const target = nodesById.get(edge.to);
    if (!target || target.kind !== 'project') continue;
    if (parentOf.has(edge.to)) continue;
    parentOf.set(edge.to, edge.from);
  }

  // 3. Keyword filter, then one hop of relationship context.
  const needle = opts.filter.trim().toLowerCase();
  const visibleProjectIds = new Set<string>();
  if (needle === '') {
    for (const project of projects) visibleProjectIds.add(project.id);
  } else {
    const matched = new Set<string>();
    for (const project of projects) {
      if (project.name.trim().toLowerCase().includes(needle)) matched.add(project.id);
    }
    for (const id of matched) visibleProjectIds.add(id);
    for (const edge of relationshipEdges) {
      if (matched.has(edge.from)) visibleProjectIds.add(edge.to);
      if (matched.has(edge.to)) visibleProjectIds.add(edge.from);
    }
  }

  // 4. Relationship edges survive only when both endpoints are visible.
  const visibleRelationshipEdges = relationshipEdges.filter(
    edge => visibleProjectIds.has(edge.from) && visibleProjectIds.has(edge.to),
  );

  // 5. Real containers — dropped when empty, unless explicitly scoped to.
  const containers: Container[] = [];
  for (const group of groups) {
    const memberIds = projects
      .filter(project => visibleProjectIds.has(project.id) && parentOf.get(project.id) === group.id)
      .map(project => project.id);
    if (memberIds.length === 0 && group.id !== opts.scope) continue;
    containers.push({ id: group.id, label: group.name, synthetic: false, memberIds });
  }

  // 6. Synthetic Ungrouped container — visible projects with no resolved parent.
  const ungroupedMemberIds = projects
    .filter(project => visibleProjectIds.has(project.id) && !parentOf.has(project.id))
    .map(project => project.id);
  if (ungroupedMemberIds.length > 0) {
    containers.push({
      id: UNGROUPED_ID,
      label: UNGROUPED_LABEL,
      synthetic: true,
      memberIds: ungroupedMemberIds,
    });
  }

  // 7-9. Containers first, then children — React Flow needs a parent's node to
  // precede its children in the array, not just be present somewhere in it.
  const nodes: WorkGraphFlowNode[] = [];
  for (const container of containers) {
    const data: WorkGraphContainerData = {
      id: container.id,
      label: container.label,
      count: container.memberIds.length,
      synthetic: container.synthetic,
    };
    nodes.push({
      id: container.id,
      type: 'workGraphContainer',
      position: { x: 0, y: 0 },
      data,
    });
  }

  const projectsById = new Map(projects.map(project => [project.id, project]));
  for (const container of containers) {
    for (const projectId of container.memberIds) {
      const project = projectsById.get(projectId);
      if (!project) continue;
      const data: WorkGraphProjectData = {
        id: project.id,
        label: project.name,
        tier: project.tier ?? 'not_initialized',
        state: project.state,
        stateLabel: project.stateLabel,
        projectType: project.projectType,
      };
      nodes.push({
        id: project.id,
        type: 'workGraphProject',
        position: { x: 0, y: 0 },
        data,
        parentId: container.id,
        extent: 'parent',
      });
    }
  }

  // 10. Relationship edges — source/target/label preserved verbatim, never inverted.
  const edges: WorkGraphFlowEdge[] = visibleRelationshipEdges.map(edge => ({
    id: `${edge.type}:${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    markerEnd: { type: 'arrowclosed' },
    label: edge.type,
    animated: false,
    ranking: edge.ranking,
    style: getEdgeStyle(edge.type, edge.ranking),
  }));

  return { nodes, edges };
}
