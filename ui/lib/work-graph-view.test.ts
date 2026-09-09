import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildWorkGraphView, resolveEnabledEdgeTypes, edgeTypeStrokeColor, UNGROUPED_ID, UNGROUPED_LABEL } from './work-graph-view';
import type { WorkGraphResponse, WorkGraphFlowNode, EdgeTypeKey } from '@/types/work-graph';

// The transform tests below exercise containers/keyword-filter/styling
// mechanics, not edge-type visibility — pass every key so none of the
// fixture's edges are dropped by the new visibility filter.
const ALL_EDGE_TYPES: EdgeTypeKey[] = ['follows', 'depends-on', 'spawned-from', 'other'];

// ── Fixture ───────────────────────────────────────────────────────────────────
// Hand-authored — never sourced from a developer's real ~/.radorc, which changes.
//
//   group:alpha  { proj:a1 (planning), proj:a2 (execution) }
//   group:beta   { proj:b1 (review) }
//   group:tr-tech-debt  -- its only `contains` edge targets proj:ghost, which does
//     not exist in `nodes`. Mirrors the live store's tr-tech-debt group, whose
//     directory was deleted: zero resolvable members.
//   ungrouped:   proj:u1 (tier null), proj:u2 (halted), proj:u3 (complete)
//
//   edges:
//     contains  group:alpha -> proj:a1
//     contains  group:alpha -> proj:a2
//     contains  group:beta  -> proj:b1
//     contains  group:tr-tech-debt -> proj:ghost         (dangling; ignored)
//     follows   proj:a1 -> proj:b1                        (cross-group)
//     corrective proj:a2 -> proj:u1                       (unknown edge type)
//     depends-on proj:u1 -> proj:u2                        (unknown edge type)
//   proj:u3 carries no edges at all.
function buildFixture(): WorkGraphResponse {
  return {
    schema: 'work-graph/v1',
    nodes: [
      { id: 'group:alpha', kind: 'group', name: 'Alpha' },
      { id: 'group:beta', kind: 'group', name: 'Beta' },
      { id: 'group:tr-tech-debt', kind: 'group', name: 'Tech Debt' },
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
      { type: 'contains', from: 'group:tr-tech-debt', to: 'proj:ghost', ranking: false },
      { type: 'follows', from: 'proj:a1', to: 'proj:b1', ranking: true },
      { type: 'corrective', from: 'proj:a2', to: 'proj:u1', ranking: false },
      { type: 'depends-on', from: 'proj:u1', to: 'proj:u2', ranking: true },
    ],
    groups: [
      { id: 'group:alpha', name: 'Alpha' },
      { id: 'group:beta', name: 'Beta' },
      { id: 'group:tr-tech-debt', name: 'Tech Debt' },
    ],
    danglingEdgeCount: 1,
  };
}

function containerNode(nodes: WorkGraphFlowNode[], id: string) {
  return nodes.find(n => n.id === id && n.type === 'workGraphContainer');
}

describe('buildWorkGraphView', () => {
  it('nests contained projects under real containers, collects the rest into Ungrouped, keeps the cross-group edge, and labels an unknown edge type verbatim', () => {
    const { nodes, edges } = buildWorkGraphView(buildFixture(), { filter: '', scope: 'all', enabledEdgeTypes: ALL_EDGE_TYPES });

    const alpha = containerNode(nodes, 'group:alpha');
    const beta = containerNode(nodes, 'group:beta');
    const ungrouped = containerNode(nodes, UNGROUPED_ID);
    assert.ok(alpha && beta && ungrouped, 'expected alpha, beta, and Ungrouped containers');
    assert.strictEqual((alpha!.data as { count: number }).count, 2);
    assert.strictEqual((beta!.data as { count: number }).count, 1);
    assert.strictEqual((ungrouped!.data as { count: number }).count, 3);
    assert.strictEqual((ungrouped!.data as { label: string }).label, UNGROUPED_LABEL);
    assert.strictEqual((ungrouped!.data as { synthetic: boolean }).synthetic, true);

    // tr-tech-debt has zero resolvable members and wasn't explicitly scoped — dropped.
    assert.strictEqual(containerNode(nodes, 'group:tr-tech-debt'), undefined);

    const a1 = nodes.find(n => n.id === 'proj:a1');
    const a2 = nodes.find(n => n.id === 'proj:a2');
    const b1 = nodes.find(n => n.id === 'proj:b1');
    assert.strictEqual(a1?.parentId, 'group:alpha');
    assert.strictEqual(a2?.parentId, 'group:alpha');
    assert.strictEqual(b1?.parentId, 'group:beta');

    const crossGroupEdge = edges.find(e => e.source === 'proj:a1' && e.target === 'proj:b1');
    assert.ok(crossGroupEdge, 'cross-group follows edge should survive');
    assert.strictEqual(crossGroupEdge!.label, 'follows');
    assert.strictEqual(crossGroupEdge!.type, 'smoothstep');
    assert.strictEqual(crossGroupEdge!.ranking, true, 'follows is a ranking edge type');

    const unknownTypeEdge = edges.find(e => e.source === 'proj:u1' && e.target === 'proj:u2');
    assert.ok(unknownTypeEdge, 'depends-on edge should survive and render');
    assert.strictEqual(unknownTypeEdge!.label, 'depends-on', 'unrecognized types render their own label, not blank');
    assert.strictEqual(unknownTypeEdge!.ranking, true, 'depends-on is a ranking edge type');

    const decorationEdge = edges.find(e => e.source === 'proj:a2' && e.target === 'proj:u1');
    assert.ok(decorationEdge, 'corrective (decoration) edge should survive and render');
    assert.strictEqual(decorationEdge!.ranking, false, 'ranking classification is carried through verbatim, not recomputed');

    // Verify edge styling
    const followsEdge = edges.find(e => e.source === 'proj:a1' && e.target === 'proj:b1');
    assert.ok(followsEdge?.style?.stroke?.includes('--color-link'), 'follows edge uses link colour');
    assert.strictEqual(followsEdge?.style?.strokeDasharray, undefined, 'follows edge (ranking: true) is solid, not dashed');

    const dependsEdge = edges.find(e => e.source === 'proj:u1' && e.target === 'proj:u2');
    assert.ok(dependsEdge?.style?.stroke?.includes('--tier-halted'), 'depends-on edge uses halted colour');
    assert.strictEqual(dependsEdge?.style?.strokeDasharray, undefined, 'depends-on edge (ranking: true) is solid, not dashed');

    assert.ok(decorationEdge?.style?.stroke?.includes('--canvas-edge-other'), 'unrecognised edge (corrective) uses the "other" token — the decoration teal at reduced opacity, not a new hue');
    assert.strictEqual(decorationEdge?.style?.strokeDasharray, '5,5', 'unrecognised edge (ranking: false) is dashed');
  });

  it('copies state and stateLabel onto project node data verbatim, including a project inside the synthetic Ungrouped container', () => {
    const { nodes } = buildWorkGraphView(buildFixture(), { filter: '', scope: 'all', enabledEdgeTypes: ALL_EDGE_TYPES });

    const a2 = nodes.find(n => n.id === 'proj:a2');
    assert.strictEqual((a2?.data as { state?: string }).state, 'executing');
    assert.strictEqual((a2?.data as { stateLabel?: string }).stateLabel, 'Executing');

    const u3 = nodes.find(n => n.id === 'proj:u3');
    assert.strictEqual(u3?.parentId, UNGROUPED_ID, 'proj:u3 is a member of the synthetic Ungrouped container');
    assert.strictEqual((u3?.data as { state?: string }).state, 'complete');
    assert.strictEqual((u3?.data as { stateLabel?: string }).stateLabel, 'Complete');
  });

  it('adds one hop of relationship context around a match rather than a bare match list', () => {
    const { nodes, edges } = buildWorkGraphView(buildFixture(), {
      filter: 'Ungrouped One',
      scope: 'all',
      enabledEdgeTypes: ALL_EDGE_TYPES,
    });

    const visibleIds = new Set(nodes.filter(n => n.type === 'workGraphProject').map(n => n.id));
    // proj:u1 matches; proj:a2 (corrective->u1) and proj:u2 (u1->depends-on) are its
    // direct relationship neighbours in either direction and must ride along.
    assert.deepStrictEqual(visibleIds, new Set(['proj:a2', 'proj:u1', 'proj:u2']));

    // proj:a1 and proj:u3 are not directly connected to the match — excluded.
    assert.ok(!visibleIds.has('proj:a1'));
    assert.ok(!visibleIds.has('proj:u3'));

    assert.strictEqual(edges.length, 2);
    assert.ok(edges.some(e => e.source === 'proj:a2' && e.target === 'proj:u1'));
    assert.ok(edges.some(e => e.source === 'proj:u1' && e.target === 'proj:u2'));
  });

  it('yields an empty canvas for a filter matching nothing, rather than falling back to the unfiltered graph', () => {
    const result = buildWorkGraphView(buildFixture(), { filter: 'no-such-project', scope: 'all', enabledEdgeTypes: ALL_EDGE_TYPES });
    assert.deepStrictEqual(result, { nodes: [], edges: [] });
  });

  it('a filter can empty a container of its real members, dropping the container entirely', () => {
    const { nodes } = buildWorkGraphView(buildFixture(), { filter: 'Alpha Two', scope: 'all', enabledEdgeTypes: ALL_EDGE_TYPES });

    // proj:a2 matches; its only relationship neighbour is proj:u1 (corrective).
    // proj:b1 (beta's only member) is not reachable in one hop, so beta empties out.
    assert.strictEqual(containerNode(nodes, 'group:beta'), undefined);

    const alpha = containerNode(nodes, 'group:alpha');
    assert.ok(alpha);
    assert.strictEqual((alpha!.data as { count: number }).count, 1, 'count follows visible members, not group membership');

    const ungrouped = containerNode(nodes, UNGROUPED_ID);
    assert.ok(ungrouped);
    assert.strictEqual((ungrouped!.data as { count: number }).count, 1);
  });

  it('an explicitly scoped group with zero resolvable members still emits its (empty) container', () => {
    const { nodes } = buildWorkGraphView(buildFixture(), { filter: '', scope: 'group:tr-tech-debt', enabledEdgeTypes: ALL_EDGE_TYPES });

    const techDebt = containerNode(nodes, 'group:tr-tech-debt');
    assert.ok(techDebt, 'scoped container must render even with zero visible members');
    assert.strictEqual((techDebt!.data as { count: number }).count, 0);
  });

  it('composes an explicit scope with a filter without either overriding the other', () => {
    const { nodes } = buildWorkGraphView(buildFixture(), {
      filter: 'Ungrouped Three', // proj:u3 — carries no edges, so no one-hop neighbours
      scope: 'group:beta',
      enabledEdgeTypes: ALL_EDGE_TYPES,
    });

    // Filter emptied beta of its real member (proj:b1 doesn't match and has no path
    // to proj:u3), but the explicit scope keeps beta's container alive at 0.
    const beta = containerNode(nodes, 'group:beta');
    assert.ok(beta, 'scoped container survives even though the filter emptied it');
    assert.strictEqual((beta!.data as { count: number }).count, 0);

    // The filter still applies normally to groups the viewer did NOT scope to.
    assert.strictEqual(containerNode(nodes, 'group:alpha'), undefined);
    assert.strictEqual(containerNode(nodes, 'group:tr-tech-debt'), undefined);

    // proj:u3 itself is still visible under Ungrouped — the filter isn't overridden either.
    const ungrouped = containerNode(nodes, UNGROUPED_ID);
    assert.ok(ungrouped);
    assert.strictEqual((ungrouped!.data as { count: number }).count, 1);
    const u3 = nodes.find(n => n.id === 'proj:u3');
    assert.strictEqual(u3?.parentId, UNGROUPED_ID);
  });

  it('emits every container before any of its children', () => {
    const { nodes } = buildWorkGraphView(buildFixture(), { filter: '', scope: 'all', enabledEdgeTypes: ALL_EDGE_TYPES });

    const containerIndex = new Map<string, number>();
    nodes.forEach((node, index) => {
      if (node.type === 'workGraphContainer') containerIndex.set(node.id, index);
    });

    for (const node of nodes) {
      if (node.type !== 'workGraphProject' || node.parentId === undefined) continue;
      const parentIndex = containerIndex.get(node.parentId);
      assert.notStrictEqual(parentIndex, undefined, `parent ${node.parentId} should have a container node`);
      const childIndex = nodes.indexOf(node);
      assert.ok(parentIndex! < childIndex, `container ${node.parentId} must precede child ${node.id}`);
    }
  });

  it('derives stroke dash from ranking, not type — an invented ranking-type renders solid without code changes', () => {
    const fixture = buildFixture();
    // Add an invented type with ranking: true (should be solid) and ranking: false (should be dashed)
    fixture.edges.push({ type: 'invented-ranking-type', from: 'proj:u2', to: 'proj:u3', ranking: true });
    fixture.edges.push({ type: 'invented-decoration-type', from: 'proj:u3', to: 'proj:a1', ranking: false });

    const { edges } = buildWorkGraphView(fixture, { filter: '', scope: 'all', enabledEdgeTypes: ALL_EDGE_TYPES });

    const inventedRankingEdge = edges.find(e => e.type === 'smoothstep' && e.source === 'proj:u2' && e.target === 'proj:u3');
    assert.ok(inventedRankingEdge, 'invented ranking-type edge should exist');
    assert.strictEqual(inventedRankingEdge?.style?.strokeDasharray, undefined, 'invented ranking-type (ranking: true) should be solid');
    assert.ok(inventedRankingEdge?.style?.stroke?.includes('--canvas-edge-other'), 'invented (unrecognised) type should use the "other" colour');

    const inventedDecorationEdge = edges.find(e => e.type === 'smoothstep' && e.source === 'proj:u3' && e.target === 'proj:a1');
    assert.ok(inventedDecorationEdge, 'invented decoration-type edge should exist');
    assert.strictEqual(inventedDecorationEdge?.style?.strokeDasharray, '5,5', 'invented decoration-type (ranking: false) should be dashed');
    assert.ok(inventedDecorationEdge?.style?.stroke?.includes('--canvas-edge-other'), 'invented (unrecognised) type should use the "other" colour');
  });

  describe('edge-type visibility', () => {
    it('omits relationship edges whose type is not enabled', () => {
      const { edges } = buildWorkGraphView(buildFixture(), { filter: '', scope: 'all', enabledEdgeTypes: ['follows'] });

      assert.strictEqual(edges.length, 1);
      assert.ok(edges.some(e => e.source === 'proj:a1' && e.target === 'proj:b1'));
      assert.ok(!edges.some(e => e.source === 'proj:u1' && e.target === 'proj:u2'), 'depends-on edge should be hidden');
      assert.ok(!edges.some(e => e.source === 'proj:a2' && e.target === 'proj:u1'), 'corrective (other) edge should be hidden');
    });

    it('an empty enabled set draws no relationship edges at all', () => {
      const { edges } = buildWorkGraphView(buildFixture(), { filter: '', scope: 'all', enabledEdgeTypes: [] });
      assert.strictEqual(edges.length, 0);
    });

    it('a hidden edge does not pull a neighbour in via the keyword filter\'s one-hop context', () => {
      // With every type enabled, matching proj:u1 pulls in both proj:a2 (corrective/"other")
      // and proj:u2 (depends-on) as one-hop neighbours — see the earlier "adds one hop" test.
      // With only depends-on enabled, the corrective edge is invisible, so its neighbour
      // proj:a2 no longer rides along, while the still-enabled depends-on neighbour does.
      const { nodes, edges } = buildWorkGraphView(buildFixture(), {
        filter: 'Ungrouped One',
        scope: 'all',
        enabledEdgeTypes: ['depends-on'],
      });

      const visibleIds = new Set(nodes.filter(n => n.type === 'workGraphProject').map(n => n.id));
      assert.deepStrictEqual(visibleIds, new Set(['proj:u1', 'proj:u2']));
      assert.strictEqual(edges.length, 1);
      assert.ok(edges.some(e => e.source === 'proj:u1' && e.target === 'proj:u2'));
    });
  });
});

describe('resolveEnabledEdgeTypes', () => {
  it('defaults to only `follows` when the parameter is absent', () => {
    assert.deepStrictEqual(resolveEnabledEdgeTypes(null), ['follows']);
  });

  it('enables nothing when the parameter is present but empty', () => {
    assert.deepStrictEqual(resolveEnabledEdgeTypes(''), []);
  });

  it('drops unrecognised tokens rather than propagating or erroring', () => {
    assert.deepStrictEqual(resolveEnabledEdgeTypes('nonsense'), []);
    assert.deepStrictEqual(resolveEnabledEdgeTypes('follows,nonsense'), ['follows']);
  });

  it('parses a comma-separated list of recognised tokens, including `other`', () => {
    assert.deepStrictEqual(resolveEnabledEdgeTypes('follows,spawned-from'), ['follows', 'spawned-from']);
    assert.deepStrictEqual(resolveEnabledEdgeTypes('other'), ['other']);
  });
});

describe('edgeTypeStrokeColor', () => {
  it('gives follows, depends-on, and spawned-from their own distinct stroke colour', () => {
    const keys: EdgeTypeKey[] = ['follows', 'depends-on', 'spawned-from'];
    const colors = keys.map(edgeTypeStrokeColor);
    assert.strictEqual(new Set(colors).size, 3, 'the three named edge types must resolve to distinct colour values');
  });

  it('resolves "other" to its own CSS token, layered on the decoration teal rather than a new hue', () => {
    assert.strictEqual(edgeTypeStrokeColor('other'), 'var(--canvas-edge-other)');
    assert.notStrictEqual(
      edgeTypeStrokeColor('other'),
      edgeTypeStrokeColor('spawned-from'),
      'other and spawned-from stay separately addressable CSS tokens for the toolbar/legend',
    );

    const css = readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf-8');
    const otherDecls = css.match(/--canvas-edge-other:\s*([^;]+);/g) ?? [];
    assert.strictEqual(otherDecls.length, 2, 'declared once per theme (light + dark)');
    for (const decl of otherDecls) {
      assert.ok(decl.includes('--canvas-edge-decoration'), `"other" must derive from the decoration teal, not spend a new hue: ${decl}`);
    }
  });
});
