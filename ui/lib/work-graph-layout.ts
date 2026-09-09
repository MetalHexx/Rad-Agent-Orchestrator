// ui/lib/work-graph-layout.ts
// Two-level dagre layout for the work graph: containers are sized to fit their
// children, children are laid out by dagre when they carry intra-container ranking
// edges and on a grid otherwise, and startFrom flips ranking without touching edge
// data. Decoration edges (ranking: false) are still rendered but never influence
// which rank a node lands on.

import dagre from '@dagrejs/dagre';
import type { WorkGraphFlowNode, WorkGraphFlowEdge, StartFrom } from '@/types/work-graph';
import { UNGROUPED_ID } from './work-graph-view';

export const NODE_WIDTH = 320;   // wider than the Process Editor's 200 — project ids are long
export const NODE_HEIGHT = 56;   // matches the rendered card exactly
export const HEADER_HEIGHT = 40; // the container's header row
export const PAD = 24;           // container padding, uniform on all four sides
export const NODE_SEP = 50;
export const RANK_SEP = 50;

interface Point { x: number; y: number; }
interface Size { width: number; height: number; }

/** Converts a dagre centre point to a React Flow top-left, snapping centre-X to the
 *  nearest even integer first so nodes sharing a column share an identical centre X —
 *  what keeps edges from rendering jagged between nodes of different widths. */
function centreToTopLeft(centreX: number, centreY: number, width: number, height: number): Point {
  const snappedCentreX = Math.round(centreX / 2) * 2;
  return { x: snappedCentreX - width / 2, y: Math.round(centreY - height / 2) };
}

/**
 * Lays out one container's children: members touched by a ranking edge go through
 * a dagre sub-graph, everyone else (including members touched only by decoration
 * edges) goes on a grid placed below it. Returns positions relative to the
 * children's own bounding box (top-left at 0,0) and that box's size. Splitting
 * (rather than an all-or-nothing per-container choice) is what keeps a container
 * with a few connected members and hundreds of unrelated ones from sending the
 * whole thing down the dagre path.
 */
function layoutChildren(
  members: WorkGraphFlowNode[],
  intraEdges: WorkGraphFlowEdge[],
  startFrom: StartFrom,
): { positions: Map<string, Point>; size: Size } {
  const positions = new Map<string, Point>();
  if (members.length === 0) {
    // An explicitly-scoped empty group still emits a container (see
    // buildWorkGraphView). A bare {0,0} here leaves only PAD*2 for the header
    // row — icon, label, and count overflow a 48px box. Keep a card-sized
    // floor so the header always has somewhere to put its contents.
    return { positions, size: { width: NODE_WIDTH, height: 0 } };
  }

  // Only ranking edges determine which nodes enter the dagre sub-graph — a node
  // touched solely by a decoration edge (e.g. spawned-from) has no ordering to
  // express and belongs in the grid block below, not the dagre block.
  const rankingEdges = intraEdges.filter((e) => e.ranking);
  const connectedIds = new Set<string>();
  for (const edge of rankingEdges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }
  const connected = members.filter((m) => connectedIds.has(m.id));
  const edgeless = members.filter((m) => !connectedIds.has(m.id));

  let dagreWidth = 0;
  let dagreHeight = 0;
  if (connected.length > 0) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: NODE_SEP, ranksep: RANK_SEP });
    g.setDefaultEdgeLabel(() => ({}));
    for (const m of connected) g.setNode(m.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    for (const edge of rankingEdges) {
      // 'oldest' reverses the dagre input so the `to` end ranks above the `from`
      // end — the rendered arrow (never touched here) still runs source -> target.
      if (startFrom === 'newest') g.setEdge(edge.source, edge.target);
      else g.setEdge(edge.target, edge.source);
    }
    dagre.layout(g);

    const raw = connected.map((m) => {
      const dn = g.node(m.id);
      const p = centreToTopLeft(dn.x, dn.y, NODE_WIDTH, NODE_HEIGHT);
      return { id: m.id, x: p.x, y: p.y };
    });
    const minX = Math.min(...raw.map((r) => r.x));
    const minY = Math.min(...raw.map((r) => r.y));
    dagreWidth = Math.max(...raw.map((r) => r.x + NODE_WIDTH)) - minX;
    dagreHeight = Math.max(...raw.map((r) => r.y + NODE_HEIGHT)) - minY;
    for (const r of raw) positions.set(r.id, { x: r.x - minX, y: r.y - minY });
  }

  let gridWidth = 0;
  let gridHeight = 0;
  if (edgeless.length > 0) {
    const cols = Math.ceil(Math.sqrt(edgeless.length));
    const rows = Math.ceil(edgeless.length / cols);
    const colPitch = NODE_WIDTH + NODE_SEP;
    const rowPitch = NODE_HEIGHT + RANK_SEP;
    const yOffset = connected.length > 0 ? dagreHeight + RANK_SEP : 0;
    edgeless.forEach((m, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.set(m.id, { x: col * colPitch, y: yOffset + row * rowPitch });
    });
    gridWidth = cols * NODE_WIDTH + (cols - 1) * NODE_SEP;
    gridHeight = rows * NODE_HEIGHT + (rows - 1) * RANK_SEP;
  }

  const width = Math.max(dagreWidth, gridWidth);
  const height =
    (connected.length > 0 ? dagreHeight : 0) +
    (edgeless.length > 0 ? (connected.length > 0 ? RANK_SEP : 0) + gridHeight : 0);

  return { positions, size: { width, height } };
}

export function computeWorkGraphLayout(
  nodes: WorkGraphFlowNode[],
  edges: WorkGraphFlowEdge[],
  startFrom: StartFrom,
): { nodes: WorkGraphFlowNode[]; edges: WorkGraphFlowEdge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const containers = nodes.filter((n) => n.type === 'workGraphContainer');
  const children = nodes.filter((n) => n.type === 'workGraphProject');
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const membersByContainer = new Map<string, WorkGraphFlowNode[]>();
  for (const child of children) {
    if (!child.parentId) continue;
    const list = membersByContainer.get(child.parentId) ?? [];
    list.push(child);
    membersByContainer.set(child.parentId, list);
  }

  // Per-container child layout — relative positions within the children's own
  // bounding box, plus that box's size (used to size the container itself).
  const containerSize = new Map<string, Size>();
  const childRelPosition = new Map<string, Point>();
  for (const container of containers) {
    const members = membersByContainer.get(container.id) ?? [];
    const memberIds = new Set(members.map((m) => m.id));
    const intraEdges = edges.filter((e) => memberIds.has(e.source) && memberIds.has(e.target));
    const { positions, size } = layoutChildren(members, intraEdges, startFrom);
    for (const [id, pos] of positions) {
      childRelPosition.set(id, { x: pos.x + PAD, y: pos.y + HEADER_HEIGHT + PAD });
    }
    containerSize.set(container.id, {
      width: size.width + PAD * 2,
      height: size.height + HEADER_HEIGHT + PAD * 2,
    });
  }

  // Top-level layout over the containers. Relationship edges that cross container
  // boundaries are fed to no dagre graph at all here or in any sub-graph — they are
  // still rendered, they just don't influence placement. The one ranking edge at
  // this level is a layout-only phantom from every real container to the synthetic
  // Ungrouped container, and it is never reversed by startFrom.
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: NODE_SEP, ranksep: RANK_SEP });
  g.setDefaultEdgeLabel(() => ({}));
  for (const container of containers) {
    const size = containerSize.get(container.id)!;
    g.setNode(container.id, { width: size.width, height: size.height });
  }
  const hasUngrouped = containers.some((c) => c.id === UNGROUPED_ID);
  if (hasUngrouped) {
    for (const container of containers) {
      if (container.id === UNGROUPED_ID) continue;
      g.setEdge(container.id, UNGROUPED_ID);
    }
  }
  dagre.layout(g);

  const containerPosition = new Map<string, Point>();
  for (const container of containers) {
    const size = containerSize.get(container.id)!;
    const dn = g.node(container.id);
    containerPosition.set(container.id, centreToTopLeft(dn.x, dn.y, size.width, size.height));
  }

  // Handle assignment, done last, from the final geometry: compare the absolute
  // centre-Y of each edge's endpoints (a child's absolute position is its
  // container's position plus its own).
  function absoluteCentreY(nodeId: string): number {
    const node = nodeById.get(nodeId);
    if (!node) return 0;
    if (node.type === 'workGraphContainer') {
      const pos = containerPosition.get(nodeId)!;
      const size = containerSize.get(nodeId)!;
      return pos.y + size.height / 2;
    }
    const containerPos = containerPosition.get(node.parentId!)!;
    const rel = childRelPosition.get(nodeId)!;
    return containerPos.y + rel.y + NODE_HEIGHT / 2;
  }

  const outNodes: WorkGraphFlowNode[] = nodes.map((node) => {
    if (node.type === 'workGraphContainer') {
      const pos = containerPosition.get(node.id)!;
      const size = containerSize.get(node.id)!;
      return { ...node, position: pos, style: { ...node.style, width: size.width, height: size.height } };
    }
    const pos = childRelPosition.get(node.id) ?? node.position;
    return { ...node, position: pos, style: { ...node.style, width: NODE_WIDTH, height: NODE_HEIGHT } };
  });

  const outEdges: WorkGraphFlowEdge[] = edges.map((edge) => {
    const sourceY = absoluteCentreY(edge.source);
    const targetY = absoluteCentreY(edge.target);
    return sourceY <= targetY
      ? { ...edge, sourceHandle: 's-bottom', targetHandle: 't-top' }
      : { ...edge, sourceHandle: 's-top', targetHandle: 't-bottom' };
  });

  return { nodes: outNodes, edges: outEdges };
}
