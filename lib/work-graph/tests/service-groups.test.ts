import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkGraphService, PROJECT_STATE_LABELS } from '../src/index.js';
import type { Result } from '../src/index.js';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got error ${r.error.code}: ${r.error.message}`);
  return r.data;
}

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-'));
  const dir = path.join(root, 'projects', 'MR-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ project: { name: 'MR-1' }, graph: { nodes: {} } }));
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('WorkGraphService structure writes', () => {
  const svc = () => new WorkGraphService({ root, exec: () => '' });
  it('creates a group with a derived id and bumps rev, rejecting an empty description', () => {
    const s = svc();
    const out = unwrap(s.createGroup({ name: 'Multi Repo', description: 'the initiative' }));
    expect(out.node.id).toBe('group:multi-repo');
    expect(out.rev).toBe(1);
    const bad = s.createGroup({ name: 'X', description: '  ' });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('expected a validation failure');
    expect(bad.error.code).toBe('validation');
    expect(bad.error.message).toMatch(/description/i);
  });
  it('adds a member via a contains edge and rejects a member that is not a real node', () => {
    const s = svc();
    unwrap(s.createGroup({ name: 'MR', description: 'd' }));
    const out = unwrap(s.addMember('group:mr', 'MR-1'));
    expect(out.rev).toBe(2);
    expect(s.getNode('group:mr') && s.listProjects({ groupId: 'group:mr' }).map((p) => p.id)).toEqual(['MR-1']);
    const ghost = s.addMember('group:mr', 'GHOST');
    expect(ghost.ok).toBe(false);
    if (ghost.ok) throw new Error('expected a validation failure');
    expect(ghost.error.code).toBe('validation');
  });
  it('updateGroup rejects an all-whitespace description without mutating the group or bumping rev', () => {
    const s = svc();
    const created = unwrap(s.createGroup({ name: 'Multi Repo', description: 'original description' }));
    const id = created.node.id;
    const revBefore = created.rev;
    const bad = s.updateGroup(id, { description: '   ' });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('expected a validation failure');
    expect(bad.error.code).toBe('validation');
    expect(bad.error.message).toBe('a non-empty description is required');
    // description must be unchanged
    const g = s.getNode(id) as import('../src/index.js').Group;
    expect(g.description).toBe('original description');
    // rev must not have bumped
    const stored = s.listGroups().find((x) => x.id === id);
    expect(stored?.description).toBe('original description');
    // confirm rev did not bump by checking another write still returns revBefore+1
    const ok = unwrap(s.updateGroup(id, { name: 'Updated Name' }));
    expect(ok.rev).toBe(revBefore + 1);
  });
  it('updateGroup returns the group rolled up from its members, not an empty rollup', () => {
    const dir = path.join(root, 'projects', 'MR-EXEC');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
      project: { name: 'MR-EXEC' },
      pipeline: { current_tier: 'execution' },
      graph: { status: 'in_progress', nodes: { phase_loop: { status: 'in_progress' } } },
    }));
    const s = svc();
    unwrap(s.createGroup({ name: 'Rollup', description: 'holds an in-flight project' }));
    unwrap(s.addMember('group:rollup', 'MR-EXEC'));
    const { node } = unwrap(s.updateGroup('group:rollup', { name: 'Rollup Renamed' }));
    expect(node.name).toBe('Rollup Renamed');
    expect(node.state).toBe('executing');
    expect(node.stateLabel).toBe(PROJECT_STATE_LABELS.executing);
  });
  it('deletes a group, cascading its contains edges and never deleting projects', () => {
    const s = svc();
    unwrap(s.createGroup({ name: 'MR', description: 'd' }));
    unwrap(s.addMember('group:mr', 'MR-1'));
    unwrap(s.deleteGroup('group:mr'));
    expect(s.getNode('group:mr')).toBeNull();
    expect(s.getNode('MR-1')?.kind).toBe('project'); // project survives
  });
});
