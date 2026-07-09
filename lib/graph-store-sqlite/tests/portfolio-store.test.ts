import type { Result } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { SqlitePortfolioStore } from '../src/portfolio-store.js';

interface ChangeLogRow {
  seq: number;
  ts: string;
  actor: string | null;
  operation: string;
  target_type: string;
  target_id: string;
  before: string | null;
  after: string | null;
}

function changeLogRows(db: ReturnType<typeof openDatabase>): ChangeLogRow[] {
  return db.prepare('SELECT * FROM portfolio_change_log ORDER BY seq ASC').all() as ChangeLogRow[];
}

function tableCount(db: ReturnType<typeof openDatabase>, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe('SqlitePortfolioStore — projects', () => {
  it('creates, reads, updates, and deletes a project round-trip', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    const created = store.createProject({ id: 'proj-a' }, 'alice');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data).toMatchObject({
      id: 'proj-a',
      status: 'planning',
      autoCommit: 'ask',
      autoPr: 'ask',
      sourceControlInitialized: false,
    });

    expect(store.getProject('proj-a')).toEqual(created.data);
    expect(store.listProjects()).toEqual([created.data]);

    const updated = store.updateProject(
      'proj-a',
      { status: 'in_progress', autoCommit: 'always' },
      'alice',
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.status).toBe('in_progress');
    expect(updated.data.autoCommit).toBe('always');
    expect(updated.data.autoPr).toBe('ask');
    expect(store.getProject('proj-a')).toEqual(updated.data);

    const deleted = store.deleteProject('proj-a', 'alice');
    expect(deleted.ok).toBe(true);
    expect(store.getProject('proj-a')).toBeNull();
  });

  it('rejects creating a project id that already exists', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);

    const result = store.createProject({ id: 'proj-a' }, null);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects updating and deleting a project that does not exist', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    const updateResult = store.updateProject('ghost', { status: 'done' }, null);
    const deleteResult = store.deleteProject('ghost', null);

    expect(updateResult.ok).toBe(false);
    expect(deleteResult.ok).toBe(false);
  });

  it('surfaces a failed Result instead of cascading when a project still owns a live dag_node', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    db.prepare(
      `INSERT INTO dag_nodes (project_id, id, type, status, order_key, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('proj-a', 'node-1', 'rad-orc:task', 'not_started', 0, '{}');

    const result = store.deleteProject('proj-a', null);

    expect(result.ok).toBe(false);
    expect(store.getProject('proj-a')).not.toBeNull();
    expect(tableCount(db, 'portfolio_change_log')).toBe(1); // only the create row
  });
});

describe('SqlitePortfolioStore — worktrees', () => {
  it('adds, lists, and removes a worktree round-trip', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);

    const added = store.addWorktree(
      { projectId: 'proj-a', repo: 'rad-orc-source', path: 'STEERABLE-DAG-2.2/rad-orc-source', branch: 'feat/x' },
      'alice',
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.data).toEqual({
      projectId: 'proj-a',
      repo: 'rad-orc-source',
      path: 'STEERABLE-DAG-2.2/rad-orc-source',
      branch: 'feat/x',
      baseBranch: null,
      prUrl: null,
    });

    expect(store.listWorktrees('proj-a')).toEqual([added.data]);

    const removed = store.removeWorktree('proj-a', 'rad-orc-source', 'alice');
    expect(removed.ok).toBe(true);
    expect(store.listWorktrees('proj-a')).toEqual([]);
  });

  it('rejects an absolute worktree path under either POSIX or Windows conventions', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);

    const posixResult = store.addWorktree(
      { projectId: 'proj-a', repo: 'repo-a', path: '/abs/path' },
      null,
    );
    const windowsResult = store.addWorktree(
      { projectId: 'proj-a', repo: 'repo-b', path: 'C:\\abs\\path' },
      null,
    );

    expect(posixResult.ok).toBe(false);
    expect(windowsResult.ok).toBe(false);
    expect(store.listWorktrees('proj-a')).toEqual([]);
  });

  it('rejects adding a worktree to a project that does not exist', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    const result = store.addWorktree({ projectId: 'ghost', repo: 'repo-a' }, null);

    expect(result.ok).toBe(false);
  });

  it('rejects removing a worktree that does not exist', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);

    const result = store.removeWorktree('proj-a', 'ghost-repo', null);

    expect(result.ok).toBe(false);
  });
});

describe('SqlitePortfolioStore — groups', () => {
  it('creates, reads, updates, and deletes a group round-trip', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    const created = store.createGroup({ id: 'group-a', description: 'Series A' }, 'alice');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data).toMatchObject({
      id: 'group-a',
      name: null,
      description: 'Series A',
      parentGroupId: null,
    });
    expect(store.getGroup('group-a')).toEqual(created.data);

    const updated = store.updateGroup(
      'group-a',
      { name: 'Series A', description: 'Updated description' },
      'alice',
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.name).toBe('Series A');
    expect(updated.data.description).toBe('Updated description');
    expect(store.getGroup('group-a')).toEqual(updated.data);

    const deleted = store.deleteGroup('group-a', 'alice');
    expect(deleted.ok).toBe(true);
    expect(store.getGroup('group-a')).toBeNull();
  });

  it('rejects an empty (or whitespace-only) description on create and on update', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    const created = store.createGroup({ id: 'group-a', description: '   ' }, null);
    expect(created.ok).toBe(false);
    expect(store.getGroup('group-a')).toBeNull();

    store.createGroup({ id: 'group-b', description: 'Series B' }, null);
    const updated = store.updateGroup('group-b', { description: '' }, null);
    expect(updated.ok).toBe(false);
    expect(store.getGroup('group-b')?.description).toBe('Series B');
  });

  it('rejects updating or deleting a group that does not exist', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    expect(store.updateGroup('ghost', { description: 'x' }, null).ok).toBe(false);
    expect(store.deleteGroup('ghost', null).ok).toBe(false);
  });

  it('assigns a project to a group and nests a sub-group; listGroupChildren returns the union', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createGroup({ id: 'parent-group', description: 'Parent' }, null);
    store.createGroup({ id: 'child-group', description: 'Child' }, null);
    store.createProject({ id: 'proj-a' }, null);
    store.createProject({ id: 'proj-b' }, null);

    const assigned = store.setProjectGroup('proj-a', 'parent-group', 'alice');
    expect(assigned.ok).toBe(true);
    if (assigned.ok) expect(assigned.data.groupId).toBe('parent-group');

    const nested = store.setParentGroup('child-group', 'parent-group', 'alice');
    expect(nested.ok).toBe(true);
    if (nested.ok) expect(nested.data.parentGroupId).toBe('parent-group');

    const children = store.listGroupChildren('parent-group');
    expect(children.projects.map((p) => p.id)).toEqual(['proj-a']);
    expect(children.subGroups.map((g) => g.id)).toEqual(['child-group']);

    // proj-b was never assigned and child-group has no children of its own.
    expect(store.listGroupChildren('child-group')).toEqual({ projects: [], subGroups: [] });

    const unassigned = store.setProjectGroup('proj-a', null, 'alice');
    expect(unassigned.ok).toBe(true);
    expect(store.listGroupChildren('parent-group').projects).toEqual([]);
  });

  it('rejects setProjectGroup/setParentGroup against a project or group that does not exist', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    store.createGroup({ id: 'group-a', description: 'Group A' }, null);

    expect(store.setProjectGroup('ghost-project', 'group-a', null).ok).toBe(false);
    expect(store.setProjectGroup('proj-a', 'ghost-group', null).ok).toBe(false);
    expect(store.setParentGroup('ghost-group', 'group-a', null).ok).toBe(false);
    expect(store.setParentGroup('group-a', 'ghost-group', null).ok).toBe(false);
  });

  it('rejects a group being set as its own parent', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createGroup({ id: 'group-a', description: 'Group A' }, null);

    const result = store.setParentGroup('group-a', 'group-a', null);

    expect(result.ok).toBe(false);
    expect(store.getGroup('group-a')?.parentGroupId).toBeNull();
  });

  it('orphans child projects and promotes sub-groups to the root on group delete (DDL SET NULL)', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createGroup({ id: 'parent-group', description: 'Parent' }, null);
    store.createGroup({ id: 'child-group', description: 'Child' }, null);
    store.createProject({ id: 'proj-a' }, null);
    store.setProjectGroup('proj-a', 'parent-group', null);
    store.setParentGroup('child-group', 'parent-group', null);

    const deleted = store.deleteGroup('parent-group', null);

    expect(deleted.ok).toBe(true);
    expect(store.getProject('proj-a')?.groupId).toBeNull();
    expect(store.getGroup('child-group')?.parentGroupId).toBeNull();
  });
});

describe('SqlitePortfolioStore — edges', () => {
  it('adds, lists in both directions, and removes an edge round-trip', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    store.createProject({ id: 'proj-b' }, null);

    const added = store.addEdge('proj-a', 'proj-b', 'follows', 'alice');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.data).toEqual({ fromProjectId: 'proj-a', toProjectId: 'proj-b', type: 'follows' });

    expect(store.listEdgesFrom('proj-a')).toEqual([added.data]);
    expect(store.listEdgesTo('proj-b')).toEqual([added.data]);
    expect(store.listEdgesFrom('proj-b')).toEqual([]);
    expect(store.listEdgesTo('proj-a')).toEqual([]);

    const removed = store.removeEdge('proj-a', 'proj-b', 'follows', 'alice');
    expect(removed.ok).toBe(true);
    expect(store.listEdgesFrom('proj-a')).toEqual([]);
    expect(store.listEdgesTo('proj-b')).toEqual([]);
  });

  it('rejects a self-edge', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);

    const result = store.addEdge('proj-a', 'proj-a', 'follows', null);

    expect(result.ok).toBe(false);
    expect(store.listEdgesFrom('proj-a')).toEqual([]);
  });

  it('rejects an edge to or from a project that does not exist', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);

    expect(store.addEdge('proj-a', 'ghost', 'follows', null).ok).toBe(false);
    expect(store.addEdge('ghost', 'proj-a', 'follows', null).ok).toBe(false);
  });

  it('rejects a duplicate edge and removing an edge that does not exist', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    store.createProject({ id: 'proj-b' }, null);
    store.addEdge('proj-a', 'proj-b', 'follows', null);

    expect(store.addEdge('proj-a', 'proj-b', 'follows', null).ok).toBe(false);
    expect(store.removeEdge('proj-a', 'proj-b', 'spawned-from', null).ok).toBe(false);
  });

  it('rejects a direct 2-cycle, leaving no row', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    store.createProject({ id: 'proj-b' }, null);
    store.addEdge('proj-a', 'proj-b', 'follows', null);

    const result = store.addEdge('proj-b', 'proj-a', 'follows', null);

    expect(result.ok).toBe(false);
    expect(store.listEdgesFrom('proj-b')).toEqual([]);
  });

  it('rejects a longer transitive cycle, leaving no row', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    for (const id of ['proj-a', 'proj-b', 'proj-c', 'proj-d']) {
      store.createProject({ id }, null);
    }
    store.addEdge('proj-a', 'proj-b', 'follows', null);
    store.addEdge('proj-b', 'proj-c', 'follows', null);
    store.addEdge('proj-c', 'proj-d', 'follows', null);

    const result = store.addEdge('proj-d', 'proj-a', 'follows', null);

    expect(result.ok).toBe(false);
    expect(store.listEdgesFrom('proj-d')).toEqual([]);
  });

  it('does not let a follows cycle block a legal spawned-from edge between the same pair', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    store.createProject({ id: 'proj-b' }, null);
    store.addEdge('proj-a', 'proj-b', 'follows', null);

    // proj-b -> proj-a would close a `follows` cycle, but `spawned-from` is an independent graph.
    const result = store.addEdge('proj-b', 'proj-a', 'spawned-from', null);

    expect(result.ok).toBe(true);
    expect(store.listEdgesFrom('proj-b')).toEqual([
      { fromProjectId: 'proj-b', toProjectId: 'proj-a', type: 'spawned-from' },
    ]);
  });
});

describe('SqlitePortfolioStore — audit fidelity', () => {
  it('writes exactly one portfolio_change_log row per successful mutation, with faithful before/after', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    store.createProject({ id: 'proj-a' }, 'alice');
    store.updateProject('proj-a', { status: 'in_progress' }, 'alice');
    store.addWorktree({ projectId: 'proj-a', repo: 'repo-a' }, 'alice');
    store.removeWorktree('proj-a', 'repo-a', 'alice');
    store.deleteProject('proj-a', 'alice');

    const rows = changeLogRows(db);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.operation)).toEqual([
      'project.created',
      'project.updated',
      'worktree.added',
      'worktree.removed',
      'project.deleted',
    ]);

    const createdRow = rows[0];
    expect(createdRow.actor).toBe('alice');
    expect(createdRow.target_type).toBe('project');
    expect(createdRow.target_id).toBe('proj-a');
    expect(createdRow.before).toBeNull();
    expect(JSON.parse(createdRow.after as string)).toMatchObject({ id: 'proj-a', status: 'planning' });

    const updatedRow = rows[1];
    expect(JSON.parse(updatedRow.before as string)).toMatchObject({ status: 'planning' });
    expect(JSON.parse(updatedRow.after as string)).toMatchObject({ status: 'in_progress' });

    const deletedRow = rows[4];
    expect(JSON.parse(deletedRow.before as string)).toMatchObject({ id: 'proj-a' });
    expect(deletedRow.after).toBeNull();
  });

  it('writes exactly one portfolio_change_log row per group and edge mutation', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    store.createProject({ id: 'proj-b' }, null);
    const baseline = changeLogRows(db).length;

    const mutations: Array<() => Result<unknown>> = [
      () => store.createGroup({ id: 'group-a', description: 'Group A' }, 'alice'),
      () => store.updateGroup('group-a', { description: 'Updated' }, 'alice'),
      () => store.setProjectGroup('proj-a', 'group-a', 'alice'),
      () => store.createGroup({ id: 'group-b', description: 'Group B' }, 'alice'),
      () => store.setParentGroup('group-b', 'group-a', 'alice'),
      () => store.addEdge('proj-a', 'proj-b', 'follows', 'alice'),
      () => store.removeEdge('proj-a', 'proj-b', 'follows', 'alice'),
      () => store.deleteGroup('group-b', 'alice'),
      () => store.deleteGroup('group-a', 'alice'),
    ];

    mutations.forEach((mutation, index) => {
      const result = mutation();
      expect(result.ok).toBe(true);
      expect(changeLogRows(db)).toHaveLength(baseline + index + 1);
    });
  });

  it('writes no audit row when a mutation is rejected before any write', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    const result = store.updateProject('ghost', { status: 'done' }, null);

    expect(result.ok).toBe(false);
    expect(changeLogRows(db)).toHaveLength(0);
  });

  it('rolls back both the write and the audit row when the underlying SQL write throws', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    db.prepare(
      `INSERT INTO dag_nodes (project_id, id, type, status, order_key, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('proj-a', 'node-1', 'rad-orc:task', 'not_started', 0, '{}');
    const rowsBefore = changeLogRows(db).length;
    const projectCountBefore = tableCount(db, 'projects');

    const result = store.deleteProject('proj-a', null);

    expect(result.ok).toBe(false);
    expect(tableCount(db, 'projects')).toBe(projectCountBefore);
    expect(changeLogRows(db)).toHaveLength(rowsBefore);
  });
});
