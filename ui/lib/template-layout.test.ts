import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeTemplateLayout, NODE_WIDTH, NODE_HEIGHT, PAD_LEFT, PAD_TOP } from './template-layout';
import { parseTemplateToGraph } from './template-serializer';

// ── Fixture loading ───────────────────────────────────────────────────────────

const EXTRA_HIGH_YAML = readFileSync(
  join(__dirname, '../../runtime-config/templates/extra-high.yml'),
  'utf-8'
);

// ── computeTemplateLayout ─────────────────────────────────────────────────────

describe('computeTemplateLayout', () => {
  // ── Valid positions ─────────────────────────────────────────────────────────

  describe('valid positions', () => {
    it('all nodes have finite x and y >= 0 after layout with extra-high.yml', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      assert.ok(result.nodes.length > 0, 'expected at least one node');
      for (const node of result.nodes) {
        assert.ok(
          Number.isFinite(node.position.x),
          `node ${node.id} position.x is not finite`
        );
        assert.ok(
          Number.isFinite(node.position.y),
          `node ${node.id} position.y is not finite`
        );
        assert.ok(node.position.x >= 0, `node ${node.id} position.x is negative`);
        assert.ok(node.position.y >= 0, `node ${node.id} position.y is negative`);
      }
    });
  });

  // ── Group node dimensions ───────────────────────────────────────────────────

  describe('group node dimensions', () => {
    it('top-level templateGroup nodes with children have positive finite style.width and style.height', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      // The layout sizes group nodes at all nesting depths
      const topLevelGroupNodes = result.nodes.filter(
        (n) => n.type === 'templateGroup' && !n.parentId
      );
      assert.ok(topLevelGroupNodes.length > 0, 'expected at least one top-level templateGroup node');
      for (const node of topLevelGroupNodes) {
        // Only top-level groups that have children get style dimensions
        const hasChildren = result.nodes.some((n) => n.parentId === node.id);
        if (!hasChildren) continue;
        assert.ok(node.style !== undefined, `top-level group node ${node.id} has no style`);
        const width = node.style!.width as number;
        const height = node.style!.height as number;
        assert.ok(
          Number.isFinite(width) && width > 0,
          `group node ${node.id} style.width is not positive finite (got ${width})`
        );
        assert.ok(
          Number.isFinite(height) && height > 0,
          `group node ${node.id} style.height is not positive finite (got ${height})`
        );
      }
    });
  });

  // ── Children within parent bounds ───────────────────────────────────────────

  describe('children within parent bounds', () => {
    it('direct children of top-level group nodes fit within their parent dimensions', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));
      // Only top-level group nodes (no parentId) receive style.width/height from layout
      const topLevelGroupIds = new Set(
        result.nodes
          .filter((n) => n.type === 'templateGroup' && !n.parentId)
          .map((n) => n.id)
      );
      // Find children whose parent is a top-level group
      const directChildren = result.nodes.filter(
        (n) => n.parentId !== undefined && topLevelGroupIds.has(n.parentId)
      );
      assert.ok(directChildren.length > 0, 'expected at least one direct child of a top-level group');
      for (const child of directChildren) {
        const parent = nodeMap.get(child.parentId!)!;
        assert.ok(parent.style !== undefined, `parent ${parent.id} has no style`);
        const parentWidth = parent.style!.width as number;
        const parentHeight = parent.style!.height as number;
        assert.ok(child.position.x >= 0, `child ${child.id} position.x is negative`);
        assert.ok(child.position.y >= 0, `child ${child.id} position.y is negative`);
        assert.ok(
          child.position.x + NODE_WIDTH <= parentWidth,
          `child ${child.id} overflows parent width: ${child.position.x} + ${NODE_WIDTH} > ${parentWidth}`
        );
        assert.ok(
          child.position.y + NODE_HEIGHT <= parentHeight,
          `child ${child.id} overflows parent height: ${child.position.y} + ${NODE_HEIGHT} > ${parentHeight}`
        );
      }
    });
  });

  // ── Relative positioning ────────────────────────────────────────────────────

  describe('relative positioning', () => {
    it('direct children of top-level groups start at padding offsets relative to parent origin', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      // The layout repositions children of group nodes at all nesting depths
      const topLevelGroupIds = new Set(
        result.nodes
          .filter((n) => n.type === 'templateGroup' && !n.parentId)
          .map((n) => n.id)
      );
      const directChildren = result.nodes.filter(
        (n) => n.parentId !== undefined && topLevelGroupIds.has(n.parentId)
      );
      assert.ok(directChildren.length > 0, 'expected at least one direct child of a top-level group');
      for (const child of directChildren) {
        assert.ok(
          child.position.x >= PAD_LEFT,
          `child ${child.id} position.x (${child.position.x}) should be >= PAD_LEFT (${PAD_LEFT})`
        );
        assert.ok(
          child.position.y >= PAD_TOP,
          `child ${child.id} position.y (${child.position.y}) should be >= PAD_TOP (${PAD_TOP})`
        );
      }
    });
  });

  // ── Nested group layout ─────────────────────────────────────────────────────

  describe('nested group layout', () => {
    it('nested templateGroup nodes have positive finite style.width and style.height', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      const nestedGroupNodes = result.nodes.filter(
        (n) => n.type === 'templateGroup' && n.parentId !== undefined
      );
      assert.ok(
        nestedGroupNodes.length > 0,
        'expected at least one nested templateGroup node (e.g. task_loop)'
      );
      for (const node of nestedGroupNodes) {
        assert.ok(node.style !== undefined, `nested group node ${node.id} has no style`);
        const width = node.style!.width as number;
        const height = node.style!.height as number;
        assert.ok(
          Number.isFinite(width) && width > 0,
          `nested group node ${node.id} style.width is not positive finite (got ${width})`
        );
        assert.ok(
          Number.isFinite(height) && height > 0,
          `nested group node ${node.id} style.height is not positive finite (got ${height})`
        );
      }
    });

    it('children of nested templateGroup nodes start at padding offsets', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      const nestedGroupIds = new Set(
        result.nodes
          .filter((n) => n.type === 'templateGroup' && n.parentId !== undefined)
          .map((n) => n.id)
      );
      const children = result.nodes.filter(
        (n) => n.parentId !== undefined && nestedGroupIds.has(n.parentId)
      );
      assert.ok(
        children.length > 0,
        'expected at least one child of a nested templateGroup node'
      );
      for (const child of children) {
        assert.ok(
          child.position.x >= PAD_LEFT,
          `child ${child.id} position.x (${child.position.x}) should be >= PAD_LEFT (${PAD_LEFT})`
        );
        assert.ok(
          child.position.y >= PAD_TOP,
          `child ${child.id} position.y (${child.position.y}) should be >= PAD_TOP (${PAD_TOP})`
        );
      }
    });

    it('children of nested templateGroup nodes fit within parent computed dimensions', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));
      const nestedGroupIds = new Set(
        result.nodes
          .filter((n) => n.type === 'templateGroup' && n.parentId !== undefined)
          .map((n) => n.id)
      );
      const children = result.nodes.filter(
        (n) => n.parentId !== undefined && nestedGroupIds.has(n.parentId)
      );
      assert.ok(
        children.length > 0,
        'expected at least one child of a nested templateGroup node'
      );
      for (const child of children) {
        const parent = nodeMap.get(child.parentId!)!;
        assert.ok(parent.style !== undefined, `parent ${parent.id} has no style`);
        const parentWidth = parent.style!.width as number;
        const parentHeight = parent.style!.height as number;
        const childWidth =
          child.type === 'templateGroup' && child.style?.width
            ? (child.style.width as number)
            : NODE_WIDTH;
        const childHeight =
          child.type === 'templateGroup' && child.style?.height
            ? (child.style.height as number)
            : NODE_HEIGHT;
        assert.ok(
          child.position.x + childWidth <= parentWidth,
          `child ${child.id} overflows parent width: ${child.position.x} + ${childWidth} > ${parentWidth}`
        );
        assert.ok(
          child.position.y + childHeight <= parentHeight,
          `child ${child.id} overflows parent height: ${child.position.y} + ${childHeight} > ${parentHeight}`
        );
      }
    });
  });

  // ── Edge preservation ───────────────────────────────────────────────────────

  describe('edge preservation', () => {
    it('edge count is preserved for extra-high.yml', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      assert.strictEqual(result.edges.length, edges.length, 'edge count changed after layout');
    });

    it('edges are structurally identical (same id, source, target) for extra-high.yml', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      for (let i = 0; i < edges.length; i++) {
        assert.strictEqual(result.edges[i].id, edges[i].id, `edge[${i}] id changed`);
        assert.strictEqual(result.edges[i].source, edges[i].source, `edge[${i}] source changed`);
        assert.strictEqual(result.edges[i].target, edges[i].target, `edge[${i}] target changed`);
      }
    });
  });

  // ── dagre configuration (TB direction) ─────────────────────────────────────

  describe('dagre configuration', () => {
    it('top-level source nodes have smaller position.y than their targets (TB rankdir)', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      const topLevelIds = new Set(
        result.nodes.filter((n) => !n.parentId).map((n) => n.id)
      );
      const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));
      const topLevelEdges = edges.filter(
        (e) => topLevelIds.has(e.source) && topLevelIds.has(e.target)
      );
      assert.ok(topLevelEdges.length > 0, 'expected at least one top-level edge');
      for (const edge of topLevelEdges) {
        const sourceNode = nodeMap.get(edge.source)!;
        const targetNode = nodeMap.get(edge.target)!;
        assert.ok(
          sourceNode.position.y < targetNode.position.y,
          `TB direction violated: source "${edge.source}" (y=${sourceNode.position.y}) should be above target "${edge.target}" (y=${targetNode.position.y})`
        );
      }
    });

    it('no two connected top-level nodes share the same position.y', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      const topLevelIds = new Set(
        result.nodes.filter((n) => !n.parentId).map((n) => n.id)
      );
      const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));
      const topLevelEdges = edges.filter(
        (e) => topLevelIds.has(e.source) && topLevelIds.has(e.target)
      );
      for (const edge of topLevelEdges) {
        const sourceNode = nodeMap.get(edge.source)!;
        const targetNode = nodeMap.get(edge.target)!;
        assert.notStrictEqual(
          sourceNode.position.y,
          targetNode.position.y,
          `connected nodes "${edge.source}" and "${edge.target}" share the same position.y (${sourceNode.position.y})`
        );
      }
    });
  });

  // ── Empty input ─────────────────────────────────────────────────────────────

  describe('empty input', () => {
    it('returns { nodes: [], edges: [] } for empty arrays', () => {
      const result = computeTemplateLayout([], []);
      assert.deepStrictEqual(result, { nodes: [], edges: [] });
    });
  });

  // ── Conditional group layout ─────────────────────────────────────────────────

  describe('conditional group layout', () => {
    it('conditional-with-branches nodes have type templateGroup after serialization', () => {
      const { nodes } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const prGate = nodes.find((n) => n.id === 'pr_gate');
      assert.ok(prGate !== undefined, 'expected pr_gate node to exist');
      assert.strictEqual(prGate!.type, 'templateGroup', 'pr_gate should have type templateGroup');
    });

    it('conditional parents have positive style.width and style.height after layout', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      const prGate = result.nodes.find((n) => n.id === 'pr_gate');
      assert.ok(prGate !== undefined, 'expected pr_gate node in layout result');
      assert.ok(prGate!.style !== undefined, 'pr_gate should have style');
      const pgWidth = prGate!.style!.width as number;
      const pgHeight = prGate!.style!.height as number;
      assert.ok(Number.isFinite(pgWidth) && pgWidth > 0, `pr_gate style.width should be positive (got ${pgWidth})`);
      assert.ok(Number.isFinite(pgHeight) && pgHeight > 0, `pr_gate style.height should be positive (got ${pgHeight})`);
    });

    it('children of conditional parents are positioned inside parent bounds', () => {
      const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
      const result = computeTemplateLayout(nodes, edges);
      const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));
      const finalPr = nodeMap.get('final_pr');
      const prGate = nodeMap.get('pr_gate');
      assert.ok(finalPr !== undefined, 'expected final_pr node to exist');
      assert.ok(prGate !== undefined, 'expected pr_gate node to exist');
      const pgWidth = prGate!.style!.width as number;
      const pgHeight = prGate!.style!.height as number;
      assert.ok(finalPr!.position.x >= PAD_LEFT, `final_pr position.x (${finalPr!.position.x}) should be >= PAD_LEFT (${PAD_LEFT})`);
      assert.ok(finalPr!.position.y >= PAD_TOP, `final_pr position.y (${finalPr!.position.y}) should be >= PAD_TOP (${PAD_TOP})`);
      assert.ok(finalPr!.position.x + NODE_WIDTH <= pgWidth, `final_pr overflows pr_gate width: ${finalPr!.position.x} + ${NODE_WIDTH} > ${pgWidth}`);
      assert.ok(finalPr!.position.y + NODE_HEIGHT <= pgHeight, `final_pr overflows pr_gate height: ${finalPr!.position.y} + ${NODE_HEIGHT} > ${pgHeight}`);
    });

    it('no console warning for conditional child nodes', () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
      };
      try {
        const { nodes, edges } = parseTemplateToGraph(EXTRA_HIGH_YAML);
        computeTemplateLayout(nodes, edges);
      } finally {
        console.warn = originalWarn;
      }
      const noPositionWarnings = warnings.filter((w) => w.includes('no computed position'));
      assert.strictEqual(
        noPositionWarnings.length,
        0,
        `expected no "no computed position" warnings, got: ${noPositionWarnings.join('; ')}`
      );
    });
  });
});
