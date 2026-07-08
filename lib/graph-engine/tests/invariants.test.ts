import { describe, expect, it } from 'vitest';
import {
  detectCycle,
  wouldCreateCycle,
  isTreeShaped,
  wouldCreateParentCycle,
  violatesRootGuard,
  findOrderContradictions,
} from '../src/derive/invariants.js';
import { ROOT_NODE_ID, createRootNode } from '../src/model/root.js';
import type { DagEdge, DagNode } from '../src/index.js';

function node(id: string, overrides: Partial<DagNode> = {}): DagNode {
  return {
    id,
    type: 'rad-orc:task',
    status: 'not_started',
    parent: ROOT_NODE_ID,
    order: 0,
    derivedFrom: null,
    data: {},
    ...overrides,
  };
}

function dependsOn(from: string, to: string): DagEdge {
  return { from, to, kind: 'depends_on' };
}

describe('detectCycle', () => {
  it('finds no cycle in an empty or acyclic edge set', () => {
    expect(detectCycle([])).toBeNull();
    expect(detectCycle([dependsOn('a', 'b'), dependsOn('b', 'c')])).toBeNull();
  });

  it('detects a direct cycle', () => {
    const cycle = detectCycle([dependsOn('a', 'b'), dependsOn('b', 'a')]);
    expect(cycle).not.toBeNull();
    expect(cycle).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('detects a longer transitive cycle', () => {
    const cycle = detectCycle([dependsOn('a', 'b'), dependsOn('b', 'c'), dependsOn('c', 'a')]);
    expect(cycle).not.toBeNull();
    expect(cycle).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });
});

describe('wouldCreateCycle', () => {
  it('rejects an edge that would close a cycle', () => {
    const edges = [dependsOn('a', 'b'), dependsOn('b', 'c')];
    expect(wouldCreateCycle(edges, dependsOn('c', 'a'))).toBe(true);
  });

  it('accepts an edge that keeps the graph acyclic', () => {
    const edges = [dependsOn('a', 'b')];
    expect(wouldCreateCycle(edges, dependsOn('a', 'c'))).toBe(false);
  });
});

describe('isTreeShaped', () => {
  it('holds for a well-formed containment tree', () => {
    const root = createRootNode();
    const phase = node('phase-1', { parent: ROOT_NODE_ID });
    const task = node('task-1', { parent: 'phase-1' });
    expect(isTreeShaped([root, phase, task])).toBe(true);
  });

  it('detects a cycle in the parent chain', () => {
    const a = node('a', { parent: 'b' });
    const b = node('b', { parent: 'a' });
    expect(isTreeShaped([a, b])).toBe(false);
  });
});

describe('wouldCreateParentCycle', () => {
  it('rejects re-parenting a node under itself', () => {
    const a = node('a', { parent: ROOT_NODE_ID });
    expect(wouldCreateParentCycle([a], 'a', 'a')).toBe(true);
  });

  it('rejects re-parenting a node under its own descendant', () => {
    const root = createRootNode();
    const parent = node('parent', { parent: ROOT_NODE_ID });
    const child = node('child', { parent: 'parent' });
    expect(wouldCreateParentCycle([root, parent, child], 'parent', 'child')).toBe(true);
  });

  it('accepts moving a node under an unrelated container', () => {
    const root = createRootNode();
    const a = node('a', { parent: ROOT_NODE_ID });
    const b = node('b', { parent: ROOT_NODE_ID });
    expect(wouldCreateParentCycle([root, a, b], 'a', 'b')).toBe(false);
  });
});

describe('violatesRootGuard', () => {
  it('flags remove_node and move_node targeting the root', () => {
    expect(violatesRootGuard({ kind: 'remove_node', nodeId: ROOT_NODE_ID, cascade: false })).toBe(true);
    expect(violatesRootGuard({ kind: 'move_node', nodeId: ROOT_NODE_ID, newParent: 'anywhere' })).toBe(true);
  });

  it('never flags a non-root target or add_dependency', () => {
    expect(violatesRootGuard({ kind: 'remove_node', nodeId: 'task-1', cascade: true })).toBe(false);
    expect(violatesRootGuard({ kind: 'move_node', nodeId: 'task-1', newParent: ROOT_NODE_ID })).toBe(false);
    expect(violatesRootGuard({ kind: 'add_dependency', from: 'a', to: ROOT_NODE_ID })).toBe(false);
  });
});

describe('findOrderContradictions', () => {
  it('flags a depends_on edge between siblings whose order disagrees', () => {
    const a = node('a', { parent: ROOT_NODE_ID, order: 1 });
    const b = node('b', { parent: ROOT_NODE_ID, order: 0 });
    const contradictions = findOrderContradictions([a, b], [dependsOn('a', 'b')]);
    expect(contradictions).toEqual([{ predecessor: 'a', dependent: 'b' }]);
  });

  it('is silent when order agrees, or the pair are not siblings', () => {
    const a = node('a', { parent: ROOT_NODE_ID, order: 0 });
    const b = node('b', { parent: ROOT_NODE_ID, order: 1 });
    expect(findOrderContradictions([a, b], [dependsOn('a', 'b')])).toEqual([]);

    const c = node('c', { parent: 'phase-1', order: 5 });
    expect(findOrderContradictions([a, c], [dependsOn('a', 'c')])).toEqual([]);
  });
});
