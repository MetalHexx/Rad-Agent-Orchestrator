import { NextResponse } from 'next/server';
import { WorkGraphService, isRankingEdgeType } from '@rad-orchestration/work-graph';
import type { GraphDTO, Node, Group, Edge, NodeId } from '@rad-orchestration/work-graph';
import { getRegistryRoot } from '@/lib/path-resolver';
import { toNodeDTO } from '@/lib/work-graph-dto';
import type {
  WorkGraphResponse,
  WorkGraphEdgeDTO,
  WorkGraphGroupRef,
} from '@/types/work-graph';

export const dynamic = 'force-dynamic'; // the graph is mutable state on disk
export const runtime = 'nodejs'; // the library reads the filesystem

/** The requested group id plus every id reachable by following `contains` edges from it. */
function collectScope(rootId: NodeId, edges: Edge[]): Set<NodeId> {
  const children = new Map<NodeId, NodeId[]>();
  for (const edge of edges) {
    if (edge.type !== 'contains') continue;
    const list = children.get(edge.from);
    if (list) list.push(edge.to);
    else children.set(edge.from, [edge.to]);
  }

  const scope = new Set<NodeId>([rootId]);
  const stack: NodeId[] = [rootId];
  while (stack.length > 0) {
    const current = stack.pop() as NodeId;
    for (const child of children.get(current) ?? []) {
      if (!scope.has(child)) {
        scope.add(child);
        stack.push(child);
      }
    }
  }
  return scope;
}

function toEdgeDTO(edge: Edge): WorkGraphEdgeDTO {
  return { type: edge.type, from: edge.from, to: edge.to, ranking: isRankingEdgeType(edge.type) };
}

export async function GET(req: Request) {
  try {
    const service = new WorkGraphService({
      root: getRegistryRoot(),
      // Skip worktree resolution: the library shells out to `git worktree list --porcelain`
      // once per repo binding, and this route discards the `worktrees` field entirely.
      exec: () => { throw new Error('worktree resolution disabled'); },
    });

    const graph: GraphDTO = service.getGraph();

    const groups: WorkGraphGroupRef[] = graph.nodes
      .filter((node): node is Group => node.kind === 'group')
      .map((group) => ({ id: group.id, name: group.name }));

    const requestedGroup = new URL(req.url).searchParams.get('group');
    const scopeGroup =
      requestedGroup && requestedGroup !== 'all'
        ? groups.find((group) => group.id === requestedGroup)
        : undefined;

    let scopedNodes: Node[] = graph.nodes;
    let scopedEdges: Edge[] = graph.edges;

    if (scopeGroup) {
      const scope = collectScope(scopeGroup.id, graph.edges);
      scopedNodes = graph.nodes.filter((node) => scope.has(node.id));
      scopedEdges = graph.edges.filter((edge) => scope.has(edge.from) && scope.has(edge.to));
    }

    const response: WorkGraphResponse = {
      schema: graph.schema,
      nodes: scopedNodes.map(toNodeDTO),
      edges: scopedEdges.map(toEdgeDTO),
      groups,
      danglingEdgeCount: graph.danglingEdges.length,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('GET /api/work-graph error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to read the work graph.' }, { status: 500 });
  }
}
