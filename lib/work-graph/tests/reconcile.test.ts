import { describe, it, expect } from 'vitest';
import { WorkGraph } from '../src/graph.js';
import { pruneEdges } from '../src/reconcile.js';
import { PROJECT_STATE_LABELS } from '../src/index.js';
import type { Node, Edge } from '../src/index.js';

const prj = (id: string): Node => ({ id, kind: 'project', name: id, status: 'done', state: 'complete', stateLabel: PROJECT_STATE_LABELS.complete });

describe('dangling-edge reconciliation', () => {
  const edges: Edge[] = [
    { type: 'follows', from: 'MR-2', to: 'MR-1' },     // both live
    { type: 'spawned-from', from: 'MR-X', to: 'MR-1' }, // MR-X missing
  ];
  it('elides edges with a missing endpoint into danglingEdges on compose', () => {
    const g = new WorkGraph([prj('MR-1'), prj('MR-2')], edges);
    expect(g.edges).toEqual([{ type: 'follows', from: 'MR-2', to: 'MR-1' }]);
    expect(g.danglingEdges).toEqual([{ type: 'spawned-from', from: 'MR-X', to: 'MR-1' }]);
  });
  it('pruneEdges drops only edges whose endpoints do not resolve', () => {
    const exists = (id: string) => ['MR-1', 'MR-2'].includes(id);
    const result = pruneEdges(edges, exists);
    expect(result.kept).toEqual([{ type: 'follows', from: 'MR-2', to: 'MR-1' }]);
    expect(result.removed).toEqual([{ type: 'spawned-from', from: 'MR-X', to: 'MR-1' }]);
  });
});
