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

  it('rejects a longer transitive cycle in group re-parenting, leaving no row', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createGroup({ id: 'group-a', description: 'Group A' }, null);
    store.createGroup({ id: 'group-b', description: 'Group B' }, null);
    store.createGroup({ id: 'group-c', description: 'Group C' }, null);
    store.setParentGroup('group-b', 'group-a', null);
    store.setParentGroup('group-c', 'group-b', null);

    const result = store.setParentGroup('group-a', 'group-c', null);

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

describe('SqlitePortfolioStore — external refs', () => {
  it('dedups upsertExternalRef on the (system, external_id) key, updating url/refType/data', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    const first = store.upsertExternalRef(
      { system: 'jira', externalId: 'PROJ-1', url: 'https://jira/PROJ-1', refType: 'story' },
      'alice',
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data).toMatchObject({
      system: 'jira',
      externalId: 'PROJ-1',
      url: 'https://jira/PROJ-1',
      refType: 'story',
      parentRefId: null,
      data: null,
    });

    const second = store.upsertExternalRef(
      {
        system: 'jira',
        externalId: 'PROJ-1',
        url: 'https://jira/PROJ-1-renamed',
        refType: 'epic',
        data: '{"points":3}',
      },
      'bob',
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.id).toBe(first.data.id);
    expect(second.data.url).toBe('https://jira/PROJ-1-renamed');
    expect(second.data.refType).toBe('epic');
    expect(second.data.data).toBe('{"points":3}');

    expect(tableCount(db, 'external_refs')).toBe(1);
    expect(store.getExternalRef(first.data.id)).toEqual(second.data);
  });

  it('round-trips data as an opaque string, never parsed or interpreted', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    const payload = '{"anything":["goes"],"nested":{"a":1}}';

    const created = store.upsertExternalRef(
      { system: 'github', externalId: '42', url: 'https://github/42', data: payload },
      null,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.data).toBe(payload);
    expect(store.getExternalRef(created.data.id)?.data).toBe(payload);
  });

  it('resolves a subtask -> story hierarchy via parentRefId and listChildRefs', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    const story = store.upsertExternalRef(
      { system: 'jira', externalId: 'STORY-1', url: 'https://jira/STORY-1', refType: 'story' },
      null,
    );
    expect(story.ok).toBe(true);
    if (!story.ok) return;

    const subtask = store.upsertExternalRef(
      {
        system: 'jira',
        externalId: 'SUB-1',
        url: 'https://jira/SUB-1',
        refType: 'subtask',
        parentRefId: story.data.id,
      },
      null,
    );
    expect(subtask.ok).toBe(true);
    if (!subtask.ok) return;
    expect(subtask.data.parentRefId).toBe(story.data.id);

    expect(store.listChildRefs(story.data.id)).toEqual([subtask.data]);
    expect(store.listChildRefs(subtask.data.id)).toEqual([]);
  });

  it('rejects upserting a new ref against a parentRefId that does not exist', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);

    const result = store.upsertExternalRef(
      { system: 'jira', externalId: 'SUB-1', url: 'https://jira/SUB-1', parentRefId: 'ghost' },
      null,
    );

    expect(result.ok).toBe(false);
    expect(tableCount(db, 'external_refs')).toBe(0);
  });
});

describe('SqlitePortfolioStore — project external ref links', () => {
  it('links the same ticket from two projects onto one entity row (two join rows)', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    store.createProject({ id: 'proj-b' }, null);
    const ref = store.upsertExternalRef(
      { system: 'jira', externalId: 'PROJ-1', url: 'https://jira/PROJ-1' },
      null,
    );
    expect(ref.ok).toBe(true);
    if (!ref.ok) return;

    const linkedA = store.linkProjectToRef(
      'proj-a',
      ref.data.id,
      { relation: 'implements', isPrimary: true },
      'alice',
    );
    const linkedB = store.linkProjectToRef('proj-b', ref.data.id, { relation: 'references' }, 'bob');
    expect(linkedA.ok).toBe(true);
    expect(linkedB.ok).toBe(true);
    if (!linkedA.ok || !linkedB.ok) return;
    expect(linkedA.data).toEqual({
      projectId: 'proj-a',
      externalRefId: ref.data.id,
      relation: 'implements',
      isPrimary: true,
    });
    expect(linkedB.data).toEqual({
      projectId: 'proj-b',
      externalRefId: ref.data.id,
      relation: 'references',
      isPrimary: false,
    });

    expect(tableCount(db, 'external_refs')).toBe(1);
    expect(tableCount(db, 'project_external_refs')).toBe(2);
    expect(store.listProjectsForRef(ref.data.id)).toEqual([linkedA.data, linkedB.data]);
  });

  it('links a project to multiple tickets; listRefsForProject and listProjectsForRef both resolve', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    const refA = store.upsertExternalRef({ system: 'jira', externalId: 'A-1', url: 'u1' }, null);
    const refB = store.upsertExternalRef({ system: 'jira', externalId: 'B-1', url: 'u2' }, null);
    expect(refA.ok && refB.ok).toBe(true);
    if (!refA.ok || !refB.ok) return;

    store.linkProjectToRef('proj-a', refA.data.id, {}, null);
    store.linkProjectToRef('proj-a', refB.data.id, {}, null);

    expect(store.listRefsForProject('proj-a').map((l) => l.externalRefId).sort()).toEqual(
      [refA.data.id, refB.data.id].sort(),
    );
    expect(store.listProjectsForRef(refA.data.id)).toEqual([
      { projectId: 'proj-a', externalRefId: refA.data.id, relation: null, isPrimary: false },
    ]);
  });

  it('unlinks a project from a ref round-trip', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    const ref = store.upsertExternalRef({ system: 'jira', externalId: 'A-1', url: 'u1' }, null);
    expect(ref.ok).toBe(true);
    if (!ref.ok) return;
    store.linkProjectToRef('proj-a', ref.data.id, {}, null);

    const unlinked = store.unlinkProjectFromRef('proj-a', ref.data.id, 'alice');

    expect(unlinked.ok).toBe(true);
    expect(store.listRefsForProject('proj-a')).toEqual([]);
    expect(store.listProjectsForRef(ref.data.id)).toEqual([]);
  });

  it('rejects linking to/from a project or ref that does not exist, a duplicate link, and unlinking a link that does not exist', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    const ref = store.upsertExternalRef({ system: 'jira', externalId: 'A-1', url: 'u1' }, null);
    expect(ref.ok).toBe(true);
    if (!ref.ok) return;

    expect(store.linkProjectToRef('ghost-project', ref.data.id, {}, null).ok).toBe(false);
    expect(store.linkProjectToRef('proj-a', 'ghost-ref', {}, null).ok).toBe(false);
    expect(store.unlinkProjectFromRef('proj-a', ref.data.id, null).ok).toBe(false);

    store.linkProjectToRef('proj-a', ref.data.id, {}, null);
    expect(store.linkProjectToRef('proj-a', ref.data.id, {}, null).ok).toBe(false);
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

  it('writes exactly one portfolio_change_log row per external-ref and link mutation', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    const baseline = changeLogRows(db).length;
    let refId = '';

    const mutations: Array<() => Result<unknown>> = [
      () => {
        const result = store.upsertExternalRef(
          { system: 'jira', externalId: 'PROJ-1', url: 'https://jira/PROJ-1' },
          'alice',
        );
        if (result.ok) refId = result.data.id;
        return result;
      },
      () =>
        store.upsertExternalRef(
          { system: 'jira', externalId: 'PROJ-1', url: 'https://jira/PROJ-1-renamed' },
          'alice',
        ),
      () => store.linkProjectToRef('proj-a', refId, { relation: 'implements' }, 'alice'),
      () => store.unlinkProjectFromRef('proj-a', refId, 'alice'),
    ];

    mutations.forEach((mutation, index) => {
      const result = mutation();
      expect(result.ok).toBe(true);
      expect(changeLogRows(db)).toHaveLength(baseline + index + 1);
    });

    const operations = changeLogRows(db)
      .slice(baseline)
      .map((row) => row.operation);
    expect(operations).toEqual([
      'external_ref.upserted',
      'external_ref.upserted',
      'project.linked',
      'project.unlinked',
    ]);
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
