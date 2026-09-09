import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildWorkGraphView, UNGROUPED_ID } from './work-graph-view';
import {
  computeWorkGraphLayout,
  NODE_WIDTH,
  NODE_HEIGHT,
  HEADER_HEIGHT,
  PAD,
  NODE_SEP,
} from './work-graph-layout';
import type { WorkGraphResponse, WorkGraphFlowNode, WorkGraphFlowEdge, StartFrom, EdgeTypeKey } from '@/types/work-graph';

// This suite tests layout, not visibility — pass the full vocabulary explicitly
// so the default (`['follows']`) doesn't drop the depends-on edge the
// ungrouped dagre-block assertions below depend on.
const ALL_EDGE_TYPES: EdgeTypeKey[] = ['follows', 'depends-on', 'spawned-from', 'other'];

// ── Fixture ───────────────────────────────────────────────────────────────────
// Same hand-authored fixture as P02-T01's work-graph-view.test.ts, piped through
// buildWorkGraphView, so both modules are exercised against the same data.
//
//   group:alpha  { proj:a1 (planning), proj:a2 (execution) } — no edge between them: grid.
//   group:beta   { proj:b1 (review) } — single member: grid, trivially.
//   ungrouped:   proj:u1, proj:u2 (linked by depends-on, both ungrouped: dagre),
//                proj:u3 (no edges: grid) — the mixed-split container.
//
//   edges:
//     follows    proj:a1 -> proj:b1     (cross-container; rendered, not ranked)
//     corrective proj:a2 -> proj:u1     (cross-container; rendered, not ranked)
//     depends-on proj:u1 -> proj:u2     (intra-container: drives the ungrouped dagre block)
function buildFixture(): WorkGraphResponse {
  return {
    schema: 'work-graph/v1',
    nodes: [
      { id: 'group:alpha', kind: 'group', name: 'Alpha' },
      { id: 'group:beta', kind: 'group', name: 'Beta' },
      { id: 'proj:a1', kind: 'project', name: 'Alpha One', tier: 'planning', state: 'planning', stateLabel: 'Planning', projectType: 'standard' },
      { id: 'proj:a2', kind: 'project', name: 'Alpha Two', tier: 'execution', state: 'executing', stateLabel: 'Executing', projectType: 'standard' },
      { id: 'proj:b1', kind: 'project', name: 'Beta One', tier: 'review', state: 'pending_review', stateLabel: 'Pending Review', projectType: 'standard' },
      { id: 'proj:u1', kind: 'project', name: 'Ungrouped One', tier: null, state: 'not_initialized', stateLabel: 'Not Initialized', projectType: 'standard' },
      { id: 'proj:u2', kind: 'project', name: 'Ungrouped Two', tier: 'halted', state: 'halted', stateLabel: 'Halted', projectType: 'standard' },
      { id: 'proj:u3', kind: 'project', name: 'Ungrouped Three', tier: 'complete', state: 'complete', stateLabel: 'Complete', projectType: 'standard' },
    ],
    edges: [
      { type: 'contains', from: 'group:alpha', to: 'proj:a1', ranking: false },
      { type: 'contains', from: 'group:alpha', to: 'proj:a2', ranking: false },
      { type: 'contains', from: 'group:beta', to: 'proj:b1', ranking: false },
      { type: 'follows', from: 'proj:a1', to: 'proj:b1', ranking: true },
      { type: 'corrective', from: 'proj:a2', to: 'proj:u1', ranking: false },
      { type: 'depends-on', from: 'proj:u1', to: 'proj:u2', ranking: true },
    ],
    groups: [
      { id: 'group:alpha', name: 'Alpha' },
      { id: 'group:beta', name: 'Beta' },
    ],
    danglingEdgeCount: 0,
  };
}

function buildViewInput() {
  return buildWorkGraphView(buildFixture(), { filter: '', scope: 'all', enabledEdgeTypes: ALL_EDGE_TYPES });
}

function runLayout(startFrom: StartFrom) {
  const { nodes, edges } = buildViewInput();
  return computeWorkGraphLayout(nodes, edges, startFrom);
}

function findNode(nodes: WorkGraphFlowNode[], id: string): WorkGraphFlowNode {
  const node = nodes.find((n) => n.id === id);
  assert.ok(node, `expected node ${id} to exist`);
  return node!;
}

/** Absolute centre-Y computed independently from the returned geometry (container
 *  position + child's relative position), not by re-running the layout's own logic. */
function absoluteCentreY(nodes: WorkGraphFlowNode[], id: string): number {
  const node = findNode(nodes, id);
  if (node.type === 'workGraphContainer') {
    return node.position.y + (node.style!.height as number) / 2;
  }
  const container = findNode(nodes, node.parentId!);
  return container.position.y + node.position.y + NODE_HEIGHT / 2;
}

describe('computeWorkGraphLayout', () => {
  describe('startFrom invariant', () => {
    it('flips node positions between oldest and newest while leaving source/target/label untouched', () => {
      const oldest = runLayout('oldest');
      const newest = runLayout('newest');

      assert.strictEqual(oldest.edges.length, newest.edges.length);
      for (let i = 0; i < oldest.edges.length; i++) {
        assert.strictEqual(oldest.edges[i].source, newest.edges[i].source);
        assert.strictEqual(oldest.edges[i].target, newest.edges[i].target);
        assert.strictEqual(oldest.edges[i].label, newest.edges[i].label);
      }

      const positionsDiffer = oldest.nodes.some((node) => {
        const other = findNode(newest.nodes, node.id);
        return node.position.x !== other.position.x || node.position.y !== other.position.y;
      });
      assert.ok(positionsDiffer, 'expected at least one node position to differ between modes');
    });
  });

  describe('per-container child layout split', () => {
    it('lays an edgeless container out on a grid (alpha: a1, a2 share no edge)', () => {
      const { nodes } = runLayout('oldest');
      const a1 = findNode(nodes, 'proj:a1');
      const a2 = findNode(nodes, 'proj:a2');
      // ceil(sqrt(2)) = 2 columns -> both land in the same row, different columns.
      assert.strictEqual(a1.position.y, a2.position.y);
      assert.notStrictEqual(a1.position.x, a2.position.x);
    });

    it('lays connected members of a mixed container out through dagre, ranked apart (ungrouped: u1, u2)', () => {
      const { nodes } = runLayout('oldest');
      const u1 = findNode(nodes, 'proj:u1');
      const u2 = findNode(nodes, 'proj:u2');
      assert.notStrictEqual(u1.position.y, u2.position.y, 'dagre-ranked members should not share a row');
    });

    it('places the grid remainder below the dagre block within the same container (ungrouped: u3 below u1/u2)', () => {
      const { nodes } = runLayout('oldest');
      const u1 = findNode(nodes, 'proj:u1');
      const u2 = findNode(nodes, 'proj:u2');
      const u3 = findNode(nodes, 'proj:u3');
      const dagreBottom = Math.max(u1.position.y, u2.position.y) + NODE_HEIGHT;
      assert.ok(u3.position.y >= dagreBottom, 'grid member should sit at or below the dagre block');
    });
  });

  describe('container bounds', () => {
    it('every child stays within its container bounds with at least PAD/HEADER_HEIGHT+PAD margins', () => {
      const { nodes } = runLayout('oldest');
      for (const node of nodes) {
        if (node.type !== 'workGraphProject') continue;
        const container = findNode(nodes, node.parentId!);
        const containerWidth = container.style!.width as number;
        const containerHeight = container.style!.height as number;

        assert.ok(node.position.x >= PAD, `${node.id} left margin below PAD`);
        assert.ok(node.position.y >= HEADER_HEIGHT + PAD, `${node.id} top margin below HEADER_HEIGHT+PAD`);
        assert.ok(
          node.position.x + NODE_WIDTH <= containerWidth - PAD + 0.001,
          `${node.id} overflows container right edge`,
        );
        assert.ok(
          node.position.y + NODE_HEIGHT <= containerHeight - PAD + 0.001,
          `${node.id} overflows container bottom edge`,
        );
      }
    });

    it('every node carries explicit style.width/style.height', () => {
      const { nodes } = runLayout('oldest');
      for (const node of nodes) {
        assert.ok(Number.isFinite(node.style?.width), `${node.id} missing style.width`);
        assert.ok(Number.isFinite(node.style?.height), `${node.id} missing style.height`);
      }
      const a1 = findNode(nodes, 'proj:a1');
      assert.strictEqual(a1.style!.width, NODE_WIDTH);
      assert.strictEqual(a1.style!.height, NODE_HEIGHT);
    });
  });

  describe('Ungrouped ranking', () => {
    it('positions the synthetic Ungrouped container below every real container', () => {
      const { nodes } = runLayout('oldest');
      const alpha = findNode(nodes, 'group:alpha');
      const beta = findNode(nodes, 'group:beta');
      const ungrouped = findNode(nodes, UNGROUPED_ID);

      const alphaBottom = alpha.position.y + (alpha.style!.height as number);
      const betaBottom = beta.position.y + (beta.style!.height as number);
      assert.ok(ungrouped.position.y >= alphaBottom, 'Ungrouped should sit below Alpha');
      assert.ok(ungrouped.position.y >= betaBottom, 'Ungrouped should sit below Beta');
    });
  });

  describe('handle assignment', () => {
    for (const startFrom of ['oldest', 'newest'] as StartFrom[]) {
      it(`assigns handles consistent with the final vertical order of endpoints (${startFrom})`, () => {
        const { nodes, edges } = runLayout(startFrom);
        assert.ok(edges.length > 0, 'expected at least one edge to check');
        for (const edge of edges) {
          const sourceY = absoluteCentreY(nodes, edge.source);
          const targetY = absoluteCentreY(nodes, edge.target);
          if (sourceY <= targetY) {
            assert.strictEqual(edge.sourceHandle, 's-bottom', `${edge.id} sourceHandle`);
            assert.strictEqual(edge.targetHandle, 't-top', `${edge.id} targetHandle`);
          } else {
            assert.strictEqual(edge.sourceHandle, 's-top', `${edge.id} sourceHandle`);
            assert.strictEqual(edge.targetHandle, 't-bottom', `${edge.id} targetHandle`);
          }
        }
      });
    }
  });

  describe('immutability', () => {
    it('does not mutate the input node/edge arrays', () => {
      const { nodes, edges } = buildViewInput();
      const nodesSnapshot = JSON.parse(JSON.stringify(nodes));
      const edgesSnapshot = JSON.parse(JSON.stringify(edges));
      computeWorkGraphLayout(nodes, edges, 'oldest');
      assert.deepStrictEqual(nodes, nodesSnapshot);
      assert.deepStrictEqual(edges, edgesSnapshot);
    });

    it('preserves container-before-child order', () => {
      const { nodes } = runLayout('oldest');
      const containerIndex = new Map<string, number>();
      nodes.forEach((node, index) => {
        if (node.type === 'workGraphContainer') containerIndex.set(node.id, index);
      });
      nodes.forEach((node, index) => {
        if (node.type !== 'workGraphProject') return;
        const parentIndex = containerIndex.get(node.parentId!);
        assert.ok(parentIndex !== undefined && parentIndex < index, `${node.id} should follow its container`);
      });
    });
  });

  describe('empty input', () => {
    it('returns empty nodes and edges for empty input', () => {
      const result = computeWorkGraphLayout([], [], 'oldest');
      assert.deepStrictEqual(result, { nodes: [], edges: [] });
    });
  });

  describe('explicitly-scoped empty container', () => {
    it('gives a zero-member container a card-sized minimum width, not a 48px sliver', () => {
      // group:beta filtered down to zero visible members, but still emitted
      // because it is the explicitly-selected scope (buildWorkGraphView step 5).
      const { nodes, edges } = buildWorkGraphView(buildFixture(), {
        filter: 'nope-matches-nothing',
        scope: 'group:beta',
        enabledEdgeTypes: ALL_EDGE_TYPES,
      });
      const { nodes: laidOut } = computeWorkGraphLayout(nodes, edges, 'oldest');

      const beta = findNode(laidOut, 'group:beta');
      const width = beta.style!.width as number;
      assert.ok(
        width >= NODE_WIDTH + PAD * 2,
        `empty container width ${width} should fit at least one card's worth of header content`,
      );
    });
  });

  describe('edge-type visibility feeds the layout', () => {
    it('hiding a ranking edge type reflows the nodes it used to rank — hidden implies not ranking', () => {
      const withDependsOn = buildWorkGraphView(buildFixture(), {
        filter: '',
        scope: 'all',
        enabledEdgeTypes: ALL_EDGE_TYPES,
      });
      const laidOutWith = computeWorkGraphLayout(withDependsOn.nodes, withDependsOn.edges, 'oldest');

      const withoutDependsOn = buildWorkGraphView(buildFixture(), {
        filter: '',
        scope: 'all',
        enabledEdgeTypes: ['follows'],
      });
      const laidOutWithout = computeWorkGraphLayout(withoutDependsOn.nodes, withoutDependsOn.edges, 'oldest');

      assert.notStrictEqual(
        findNode(laidOutWith.nodes, 'proj:u1').position.y,
        findNode(laidOutWithout.nodes, 'proj:u1').position.y,
        'hiding the ranking depends-on edge type should move the node it used to rank',
      );
    });
  });
});

// A synthetic edgeless-heavy fixture mirroring the live Ungrouped container's shape:
// hundreds of edgeless members plus a small connected chain, verifying the split
// keeps the grid path in play rather than collapsing to a single mile-wide dagre rank.
function buildLargeUngroupedFixture(): { nodes: WorkGraphFlowNode[]; edges: WorkGraphFlowEdge[] } {
  const nodes: WorkGraphFlowNode[] = [
    {
      id: UNGROUPED_ID,
      type: 'workGraphContainer',
      position: { x: 0, y: 0 },
      data: { id: UNGROUPED_ID, label: 'Ungrouped', count: 205, synthetic: true },
    },
  ];
  const edges: WorkGraphFlowEdge[] = [];

  for (let i = 0; i < 200; i++) {
    nodes.push({
      id: `proj:solo-${i}`,
      type: 'workGraphProject',
      position: { x: 0, y: 0 },
      data: { id: `proj:solo-${i}`, label: `SOLO-${i}`, tier: 'planning' },
      parentId: UNGROUPED_ID,
      extent: 'parent',
    });
  }

  const chain = ['proj:chain-0', 'proj:chain-1', 'proj:chain-2', 'proj:chain-3', 'proj:chain-4'];
  for (const id of chain) {
    nodes.push({
      id,
      type: 'workGraphProject',
      position: { x: 0, y: 0 },
      data: { id, label: id, tier: 'planning' },
      parentId: UNGROUPED_ID,
      extent: 'parent',
    });
  }
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push({
      id: `follows:${chain[i]}->${chain[i + 1]}`,
      source: chain[i],
      target: chain[i + 1],
      type: 'smoothstep',
      markerEnd: { type: 'arrowclosed' },
      label: 'follows',
      animated: false,
      ranking: true,
    });
  }

  return { nodes, edges };
}

describe('computeWorkGraphLayout — large edgeless Ungrouped container', () => {
  it('keeps the grid block bounded rather than sending every edgeless member down the dagre path', () => {
    const { nodes, edges } = buildLargeUngroupedFixture();
    const result = computeWorkGraphLayout(nodes, edges, 'oldest');

    const ungrouped = findNode(result.nodes, UNGROUPED_ID);
    const containerWidth = ungrouped.style!.width as number;

    // 200 edgeless members -> ceil(sqrt(200)) = 15 columns. A single-rank dagre
    // layout of 200 nodes would instead be roughly 200 * (NODE_WIDTH + NODE_SEP) wide.
    const expectedGridCols = Math.ceil(Math.sqrt(200));
    const maxSensibleWidth = expectedGridCols * (NODE_WIDTH + NODE_SEP) + PAD * 2 + 1;
    assert.ok(
      containerWidth <= maxSensibleWidth,
      `container width ${containerWidth} should stay near the grid's width, not a single dagre rank`,
    );

    const chainYs = ['proj:chain-0', 'proj:chain-1', 'proj:chain-2', 'proj:chain-3', 'proj:chain-4'].map(
      (id) => findNode(result.nodes, id).position.y,
    );
    assert.strictEqual(new Set(chainYs).size, chainYs.length, 'the connected chain should be ranked, not gridded');
  });
});

// Mirrors the live SD-2 fan: one hub, a `follows` chain (ranking), and several
// `spawned-from` edges back to the hub (decoration). All four members are always
// present; `includeRanking`/`includeDecoration` toggle which edges connect them,
// so ablations compare the same node set under a different edge set.
function flowEdge(type: string, source: string, target: string, ranking: boolean): WorkGraphFlowEdge {
  return {
    id: `${type}:${source}->${target}`,
    source,
    target,
    type: 'smoothstep',
    markerEnd: { type: 'arrowclosed' },
    label: type,
    animated: false,
    ranking,
  };
}

function buildFanFixture(opts: { includeRanking: boolean; includeDecoration: boolean }): {
  nodes: WorkGraphFlowNode[];
  edges: WorkGraphFlowEdge[];
} {
  const memberIds = ['proj:fan-hub', 'proj:fan-chain-1', 'proj:fan-deco-1', 'proj:fan-deco-2'];
  const nodes: WorkGraphFlowNode[] = [
    {
      id: UNGROUPED_ID,
      type: 'workGraphContainer',
      position: { x: 0, y: 0 },
      data: { id: UNGROUPED_ID, label: 'Ungrouped', count: memberIds.length, synthetic: true },
    },
  ];
  for (const id of memberIds) {
    nodes.push({
      id,
      type: 'workGraphProject',
      position: { x: 0, y: 0 },
      data: { id, label: id, tier: 'planning' },
      parentId: UNGROUPED_ID,
      extent: 'parent',
    });
  }

  const edges: WorkGraphFlowEdge[] = [];
  if (opts.includeRanking) {
    edges.push(flowEdge('follows', 'proj:fan-hub', 'proj:fan-chain-1', true));
  }
  if (opts.includeDecoration) {
    edges.push(flowEdge('spawned-from', 'proj:fan-deco-1', 'proj:fan-hub', false));
    edges.push(flowEdge('spawned-from', 'proj:fan-deco-2', 'proj:fan-hub', false));
  }
  return { nodes, edges };
}

describe('computeWorkGraphLayout — ranking edges only determine rank (SD-2 fan)', () => {
  it('renders the decoration edges without their presence moving any ranked node', () => {
    const { nodes, edges } = buildFanFixture({ includeRanking: true, includeDecoration: true });
    const withDeco = computeWorkGraphLayout(nodes, edges, 'oldest');

    const decoEdges = withDeco.edges.filter((e) => e.label === 'spawned-from');
    assert.strictEqual(decoEdges.length, 2, 'spawned-from edges should still be present in the output');

    const without = buildFanFixture({ includeRanking: true, includeDecoration: false });
    const withoutDeco = computeWorkGraphLayout(without.nodes, without.edges, 'oldest');

    assert.strictEqual(
      findNode(withDeco.nodes, 'proj:fan-hub').position.y,
      findNode(withoutDeco.nodes, 'proj:fan-hub').position.y,
      'hub Y should be unaffected by the presence of decoration edges',
    );
    assert.strictEqual(
      findNode(withDeco.nodes, 'proj:fan-chain-1').position.y,
      findNode(withoutDeco.nodes, 'proj:fan-chain-1').position.y,
      'chain member Y should be unaffected by the presence of decoration edges',
    );
  });

  it('removing the ranking edge does change positions', () => {
    const ranked = buildFanFixture({ includeRanking: true, includeDecoration: true });
    const withRanking = computeWorkGraphLayout(ranked.nodes, ranked.edges, 'oldest');

    const unranked = buildFanFixture({ includeRanking: false, includeDecoration: true });
    const withoutRanking = computeWorkGraphLayout(unranked.nodes, unranked.edges, 'oldest');

    assert.notStrictEqual(
      findNode(withRanking.nodes, 'proj:fan-hub').position.y,
      findNode(withoutRanking.nodes, 'proj:fan-hub').position.y,
      'removing the ranking edge should change the hub position',
    );
  });

  it('a node touched only by a decoration edge lands in the grid block below the dagre block', () => {
    const { nodes, edges } = buildFanFixture({ includeRanking: true, includeDecoration: true });
    const { nodes: laidOut } = computeWorkGraphLayout(nodes, edges, 'oldest');

    const hub = findNode(laidOut, 'proj:fan-hub');
    const chain1 = findNode(laidOut, 'proj:fan-chain-1');
    const deco1 = findNode(laidOut, 'proj:fan-deco-1');
    const deco2 = findNode(laidOut, 'proj:fan-deco-2');

    const dagreBottom = Math.max(hub.position.y, chain1.position.y) + NODE_HEIGHT;
    assert.ok(deco1.position.y >= dagreBottom, 'decoration-only member should sit at or below the dagre block');
    assert.ok(deco2.position.y >= dagreBottom, 'decoration-only member should sit at or below the dagre block');
  });

  it('startFrom flips the ranking edge but never a decoration edge', () => {
    const oldest = buildFanFixture({ includeRanking: true, includeDecoration: true });
    const oldestResult = computeWorkGraphLayout(oldest.nodes, oldest.edges, 'oldest');
    const newest = buildFanFixture({ includeRanking: true, includeDecoration: true });
    const newestResult = computeWorkGraphLayout(newest.nodes, newest.edges, 'newest');

    const hubOldestAboveChain =
      findNode(oldestResult.nodes, 'proj:fan-hub').position.y <
      findNode(oldestResult.nodes, 'proj:fan-chain-1').position.y;
    const hubNewestAboveChain =
      findNode(newestResult.nodes, 'proj:fan-hub').position.y <
      findNode(newestResult.nodes, 'proj:fan-chain-1').position.y;
    assert.notStrictEqual(hubOldestAboveChain, hubNewestAboveChain, 'the ranking edge should flip between modes');

    const decoOldest = oldestResult.edges.filter((e) => e.label === 'spawned-from');
    const decoNewest = newestResult.edges.filter((e) => e.label === 'spawned-from');
    for (let i = 0; i < decoOldest.length; i++) {
      assert.strictEqual(decoOldest[i].source, decoNewest[i].source, 'decoration edge source must never invert');
      assert.strictEqual(decoOldest[i].target, decoNewest[i].target, 'decoration edge target must never invert');
    }
  });
});
