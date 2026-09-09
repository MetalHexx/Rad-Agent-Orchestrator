import { describe, it, expect } from 'vitest';
import { WorkGraph } from '../src/graph.js';
import { PROJECT_STATE_LABELS } from '../src/index.js';
import type { Node, Edge } from '../src/index.js';

const grp = (id: string): Node => ({ id, kind: 'group', name: id, status: 'unknown', state: 'not_initialized', stateLabel: PROJECT_STATE_LABELS.not_initialized });
const prj = (id: string, status: any): Node => ({ id, kind: 'project', name: id, status, state: 'executing', stateLabel: PROJECT_STATE_LABELS.executing });

describe('WorkGraph aggregate', () => {
  it('exposes children, parents, and relationship traversal by reference', () => {
    const nodes = [grp('group:mr'), prj('MR-1', 'done'), prj('MR-2', 'in_progress')];
    const edges: Edge[] = [
      { type: 'contains', from: 'group:mr', to: 'MR-1' },
      { type: 'contains', from: 'group:mr', to: 'MR-2' },
      { type: 'follows', from: 'MR-2', to: 'MR-1' },
    ];
    const g = new WorkGraph(nodes, edges);
    expect(g.children('group:mr').map((n) => n.id)).toEqual(['MR-1', 'MR-2']);
    expect(g.parents('MR-1').map((n) => n.id)).toEqual(['group:mr']);
    expect(g.related('MR-2')).toEqual([{ type: 'follows', from: 'MR-2', to: 'MR-1' }]);
    expect(g.related('MR-2', 'spawned-from')).toEqual([]);
  });
  it('rolls a group status up over its members', () => {
    const g = new WorkGraph([grp('group:mr'), prj('MR-1', 'done'), prj('MR-2', 'in_progress')],
      [{ type: 'contains', from: 'group:mr', to: 'MR-1' }, { type: 'contains', from: 'group:mr', to: 'MR-2' }]);
    expect(g.node('group:mr')?.status).toBe('in_progress');
  });
});
