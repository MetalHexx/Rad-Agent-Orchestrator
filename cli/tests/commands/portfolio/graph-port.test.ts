import { describe, it, expect, vi } from 'vitest';
import { workGraphAdapter } from '../../../src/commands/portfolio/graph-port.js';
import type { GraphBackend } from '../../../src/commands/portfolio/graph-port.js';

const FIXTURE = {
  schema: 'work-graph/v1',
  nodes: [
    { id: 'group:portfolio', kind: 'group', name: 'Portfolio', description: 'the portfolio group' },
    { id: 'PORTFOLIO-ROOT', kind: 'project', name: 'PORTFOLIO-ROOT' },
    { id: 'OTHER-PROJECT', kind: 'project', name: 'OTHER-PROJECT' },
  ],
  edges: [{ type: 'contains', from: 'group:portfolio', to: 'PORTFOLIO-ROOT' }],
  danglingEdges: [],
};

function makeBackend() {
  return {
    getGraph: vi.fn(() => FIXTURE),
    createGroup: vi.fn(() => ({ ok: true, data: { node: { id: 'group:x' }, rev: 1 } })),
    deleteGroup: vi.fn(() => ({ ok: true, data: { rev: 2 } })),
    addMember: vi.fn(() => ({ ok: true, data: { edge: { type: 'contains', from: 'group:x', to: 'Y' }, rev: 3 } })),
    removeMember: vi.fn(() => ({ ok: true, data: { rev: 4 } })),
    link: vi.fn(() => ({ ok: true, data: { edge: { type: 'depends-on', from: 'A', to: 'B' }, rev: 5 } })),
  };
}

describe('workGraphAdapter — memoized composition', () => {
  it('serves listGroups + listMembers + getGraph off a single composition', () => {
    const backend = makeBackend();
    const port = workGraphAdapter({ root: '/root', service: backend as unknown as GraphBackend });

    const groups = port.listGroups();
    const members = port.listMembers('group:portfolio');
    const full = port.getGraph();

    expect(backend.getGraph).toHaveBeenCalledTimes(1);
    expect(groups.map((g) => g.id)).toEqual(['group:portfolio']);
    expect(members.map((m) => m.id)).toEqual(['PORTFOLIO-ROOT']);
    expect(full).toBe(FIXTURE);
  });

  it('forwards createGroup(name, description) as svc.createGroup({ name, description })', () => {
    const backend = makeBackend();
    const port = workGraphAdapter({ root: '/root', service: backend as unknown as GraphBackend });
    port.createGroup('Portfolio', 'the desc');
    expect(backend.createGroup).toHaveBeenCalledWith({ name: 'Portfolio', description: 'the desc' });
  });

  it('invalidates the cache after createGroup, so the next read recomposes', () => {
    const backend = makeBackend();
    const port = workGraphAdapter({ root: '/root', service: backend as unknown as GraphBackend });
    port.getGraph();
    port.createGroup('X', 'desc');
    port.getGraph();
    expect(backend.getGraph).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache after deleteGroup', () => {
    const backend = makeBackend();
    const port = workGraphAdapter({ root: '/root', service: backend as unknown as GraphBackend });
    port.getGraph();
    port.deleteGroup('group:x');
    port.getGraph();
    expect(backend.getGraph).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache after addMember', () => {
    const backend = makeBackend();
    const port = workGraphAdapter({ root: '/root', service: backend as unknown as GraphBackend });
    port.getGraph();
    port.addMember('group:x', 'Y');
    port.getGraph();
    expect(backend.getGraph).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache after removeMember', () => {
    const backend = makeBackend();
    const port = workGraphAdapter({ root: '/root', service: backend as unknown as GraphBackend });
    port.getGraph();
    port.removeMember('group:x', 'Y');
    port.getGraph();
    expect(backend.getGraph).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache after recordDependency', () => {
    const backend = makeBackend();
    const port = workGraphAdapter({ root: '/root', service: backend as unknown as GraphBackend });
    port.getGraph();
    port.recordDependency('A', 'B');
    port.getGraph();
    expect(backend.getGraph).toHaveBeenCalledTimes(2);
  });

  it('forwards recordDependency(from, to) as svc.link(from, to, "depends-on")', () => {
    const backend = makeBackend();
    const port = workGraphAdapter({ root: '/root', service: backend as unknown as GraphBackend });
    port.recordDependency('A', 'B');
    expect(backend.link).toHaveBeenCalledWith('A', 'B', 'depends-on');
  });
});
