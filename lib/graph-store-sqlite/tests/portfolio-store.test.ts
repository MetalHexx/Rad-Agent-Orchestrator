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
