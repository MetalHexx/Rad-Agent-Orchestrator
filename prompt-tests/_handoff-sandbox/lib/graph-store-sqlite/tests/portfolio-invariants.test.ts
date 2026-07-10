import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChangeDelta, DagNode } from '@rad-orchestration/graph-engine';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { openDatabase } from '../src/db.js';
import { SqlitePortfolioStore } from '../src/portfolio-store.js';
import { SqliteStateStore } from '../src/sqlite-state-store.js';

/** A minimal `dag_nodes` row, created via `SqliteStateStore` so these tests can exercise the
 * cross-graph node-existence check and the promote-on-delete trigger against a real node. */
function dagNode(id: string): DagNode {
  return {
    id,
    type: 'rad-orc:task',
    status: 'not_started',
    parent: ROOT_NODE_ID,
    order: 0,
    derivedFrom: null,
    data: {},
  };
}

function createNodeDelta(node: DagNode): ChangeDelta {
  return {
    primitive: 'add_node',
    params: { id: node.id },
    nodeChanges: [{ op: 'created', before: null, after: node }],
    edgeChanges: [],
  };
}

function removeNodeDelta(node: DagNode): ChangeDelta {
  return {
    primitive: 'remove_node',
    params: { id: node.id },
    nodeChanges: [{ op: 'removed', before: node, after: null }],
    edgeChanges: [],
  };
}

// Every FK's on-delete behavior, exercised end-to-end through the store's own CRUD surface (not
// raw SQL against the DDL — that's `migrations.test.ts`'s job). Each case also touches a second,
// unrelated entity to confirm the policy's blast radius is exactly what the schema promises.
describe('SqlitePortfolioStore — delete-policy matrix', () => {
  it('CASCADE: deleting a project with no owned docs and no execution nodes removes its worktrees, edges in both directions, and external-ref join rows', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    store.createProject({ id: 'proj-b' }, null);
    store.addWorktree({ projectId: 'proj-a', repo: 'repo-a' }, null);
    store.addEdge('proj-a', 'proj-b', 'follows', null);
    store.addEdge('proj-b', 'proj-a', 'spawned-from', null);
    const ref = store.upsertExternalRef(
      { system: 'jira', externalId: 'X-1', url: 'https://jira.invalid/X-1' },
      null,
    );
    expect(ref.ok).toBe(true);
    if (!ref.ok) return;
    store.linkProjectToRef('proj-a', ref.data.id, {}, null);

    const deleted = store.deleteProject('proj-a', null);

    expect(deleted.ok).toBe(true);
    expect(store.getProject('proj-a')).toBeNull();
    expect(store.getProject('proj-b')).not.toBeNull(); // the other project is untouched
    expect(store.listWorktrees('proj-a')).toEqual([]);
    expect(store.listEdgesFrom('proj-a')).toEqual([]);
    expect(store.listEdgesTo('proj-a')).toEqual([]);
    expect(store.listEdgesFrom('proj-b')).toEqual([]);
    expect(store.listEdgesTo('proj-b')).toEqual([]);
    expect(store.listProjectsForRef(ref.data.id)).toEqual([]);
    expect(store.getExternalRef(ref.data.id)).not.toBeNull(); // the ticket itself outlives the join row
  });

  it('RESTRICT: deleting a project that still owns a doc is refused, leaving the project and doc intact', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createProject({ id: 'proj-a' }, null);
    const doc = store.attachDoc({ project: 'proj-a' }, { path: 'proj-a/README.md' }, null);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;

    const result = store.deleteProject('proj-a', null);

    expect(result.ok).toBe(false);
    expect(store.getProject('proj-a')).not.toBeNull();
    expect(store.getDoc(doc.data.id)).not.toBeNull();
  });

  it('RESTRICT: deleting a group that still owns a doc is refused, leaving the group and doc intact', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createGroup({ id: 'group-a', description: 'Group A' }, null);
    const doc = store.attachDoc({ group: 'group-a' }, { path: 'group-a/CHARTER.md' }, null);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;

    const result = store.deleteGroup('group-a', null);

    expect(result.ok).toBe(false);
    expect(store.getGroup('group-a')).not.toBeNull();
    expect(store.getDoc(doc.data.id)).not.toBeNull();
  });

  it('RESTRICT: deleting a project that still owns a live dag_node is refused even when it also has worktrees, edges, and group membership', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    const nodeStore = new SqliteStateStore(db);
    store.createGroup({ id: 'group-a', description: 'Group A' }, null);
    store.createProject({ id: 'proj-a' }, null);
    store.createProject({ id: 'proj-b' }, null);
    store.setProjectGroup('proj-a', 'group-a', null);
    store.addWorktree({ projectId: 'proj-a', repo: 'repo-a' }, null);
    store.addEdge('proj-a', 'proj-b', 'follows', null);
    nodeStore.apply({ projectId: 'proj-a' }, createNodeDelta(dagNode('task-a')));

    const result = store.deleteProject('proj-a', null);

    expect(result.ok).toBe(false);
    expect(store.getProject('proj-a')).not.toBeNull();
    expect(store.listWorktrees('proj-a')).toHaveLength(1);
    expect(store.listEdgesFrom('proj-a')).toHaveLength(1);
    expect(store.getProject('proj-a')?.groupId).toBe('group-a');
  });

  it('SET NULL: deleting a group orphans its projects and promotes its sub-group, leaving unrelated project state (edges, other group membership) untouched', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    store.createGroup({ id: 'parent-group', description: 'Parent' }, null);
    store.createGroup({ id: 'child-group', description: 'Child' }, null);
    store.createProject({ id: 'proj-a' }, null);
    store.createProject({ id: 'proj-b' }, null);
    store.setProjectGroup('proj-a', 'parent-group', null);
    store.setProjectGroup('proj-b', 'child-group', null);
    store.setParentGroup('child-group', 'parent-group', null);
    store.addEdge('proj-a', 'proj-b', 'follows', null);

    const deleted = store.deleteGroup('parent-group', null);

    expect(deleted.ok).toBe(true);
    expect(store.getProject('proj-a')?.groupId).toBeNull();
    expect(store.getGroup('child-group')?.parentGroupId).toBeNull();
    expect(store.getProject('proj-b')?.groupId).toBe('child-group'); // not a direct child, untouched
    expect(store.listEdgesFrom('proj-a')).toEqual([
      { fromProjectId: 'proj-a', toProjectId: 'proj-b', type: 'follows' },
    ]);
  });

  it('DETACH-via-promote: the node-delete trigger re-homes a node-owned doc to its project, leaving the row intact and a sibling project-owned doc untouched', () => {
    const db = openDatabase(':memory:');
    const store = new SqlitePortfolioStore(db);
    const nodeStore = new SqliteStateStore(db);
    const scope = { projectId: 'proj-a' };
    store.createProject({ id: 'proj-a' }, null);
    nodeStore.apply(scope, createNodeDelta(dagNode('task-a')));

    const nodeDoc = store.attachDoc(
      { dagNode: { projectId: 'proj-a', nodeId: 'task-a' } },
      { path: 'proj-a/design/task-a.md' },
      null,
    );
    const siblingDoc = store.attachDoc({ project: 'proj-a' }, { path: 'proj-a/README.md' }, null);
    expect(nodeDoc.ok && siblingDoc.ok).toBe(true);
    if (!nodeDoc.ok || !siblingDoc.ok) return;

    const removed = nodeStore.apply(scope, removeNodeDelta(dagNode('task-a')));
    expect(removed.ok).toBe(true);

    const promoted = store.getDoc(nodeDoc.data.id);
    expect(promoted).not.toBeNull();
    expect(promoted).toMatchObject({
      id: nodeDoc.data.id,
      dagNodeId: null,
      projectId: 'proj-a',
      scopeProjectId: 'proj-a',
      path: 'proj-a/design/task-a.md',
    });
    // Exactly one owner arc, satisfying the CHECK the trigger must not violate.
    const ownerArcs = [promoted?.dagNodeId, promoted?.projectId, promoted?.groupId].filter(
      (arc) => arc != null,
    );
    expect(ownerArcs).toHaveLength(1);

    expect(store.getDoc(siblingDoc.data.id)).toEqual(siblingDoc.data);
    expect(
      store
        .listDocsForProject('proj-a')
        .map((d) => d.id)
        .sort(),
    ).toEqual([nodeDoc.data.id, siblingDoc.data.id].sort());
  });
});

// Invariants that span entities and must survive a write -> close -> reopen -> re-validate round
// trip, proving each guard re-derives from the freshly-loaded rows rather than any in-process
// cache. File-backed only — `:memory:` has no reopen story (see durability.test.ts).
describe('SqlitePortfolioStore — cross-entity invariants', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'graph-store-sqlite-portfolio-invariants-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('per-type edge acyclicity survives a serialize -> reopen -> re-validate round trip', () => {
    const db = openDatabase(dbPath);
    const store = new SqlitePortfolioStore(db);
    for (const id of ['proj-a', 'proj-b', 'proj-c']) store.createProject({ id }, null);
    store.addEdge('proj-a', 'proj-b', 'follows', null);
    store.addEdge('proj-b', 'proj-c', 'follows', null);

    db.close();

    const reopenedDb = openDatabase(dbPath);
    try {
      const reopenedStore = new SqlitePortfolioStore(reopenedDb);

      // proj-c -> proj-a would close a `follows` cycle spanning all three projects; the guard
      // must re-derive this from the freshly-loaded rows, not from any in-process cache.
      const cyclic = reopenedStore.addEdge('proj-c', 'proj-a', 'follows', null);
      expect(cyclic.ok).toBe(false);
      expect(reopenedStore.listEdgesFrom('proj-c')).toEqual([]);

      // `spawned-from` is an independent per-type graph, unaffected by the `follows` cycle guard.
      const independent = reopenedStore.addEdge('proj-c', 'proj-a', 'spawned-from', null);
      expect(independent.ok).toBe(true);

      expect(reopenedStore.listEdgesFrom('proj-a')).toEqual([
        { fromProjectId: 'proj-a', toProjectId: 'proj-b', type: 'follows' },
      ]);
      expect(reopenedStore.listEdgesFrom('proj-b')).toEqual([
        { fromProjectId: 'proj-b', toProjectId: 'proj-c', type: 'follows' },
      ]);
    } finally {
      reopenedDb.close();
    }
  });

  it('the group containment single-parent tree survives a serialize -> reopen -> re-validate round trip', () => {
    const db = openDatabase(dbPath);
    const store = new SqlitePortfolioStore(db);
    store.createGroup({ id: 'group-a', description: 'A' }, null);
    store.createGroup({ id: 'group-b', description: 'B' }, null);
    store.createGroup({ id: 'group-c', description: 'C' }, null);
    store.setParentGroup('group-b', 'group-a', null);
    store.setParentGroup('group-c', 'group-b', null);

    db.close();

    const reopenedDb = openDatabase(dbPath);
    try {
      const reopenedStore = new SqlitePortfolioStore(reopenedDb);

      // group-a -> group-c would close the persisted a -> b -> c chain into a cycle; the guard
      // must re-walk the reloaded parent_group_id chain, not an in-process ancestor cache.
      const cyclic = reopenedStore.setParentGroup('group-a', 'group-c', null);
      expect(cyclic.ok).toBe(false);
      expect(reopenedStore.getGroup('group-a')?.parentGroupId).toBeNull();

      expect(reopenedStore.getGroup('group-b')?.parentGroupId).toBe('group-a');
      expect(reopenedStore.getGroup('group-c')?.parentGroupId).toBe('group-b');
    } finally {
      reopenedDb.close();
    }
  });

  it('the exactly-one-owner CHECK holds for docs of every owner kind across a serialize -> reopen round trip, and still rejects zero or multiple owner arcs', () => {
    const db = openDatabase(dbPath);
    const store = new SqlitePortfolioStore(db);
    const nodeStore = new SqliteStateStore(db);
    const scope = { projectId: 'proj-a' };
    store.createProject({ id: 'proj-a' }, null);
    store.createGroup({ id: 'group-a', description: 'A' }, null);
    nodeStore.apply(scope, createNodeDelta(dagNode('task-a')));

    const nodeDoc = store.attachDoc(
      { dagNode: { projectId: 'proj-a', nodeId: 'task-a' } },
      { path: 'proj-a/design/task-a.md' },
      null,
    );
    const projectDoc = store.attachDoc({ project: 'proj-a' }, { path: 'proj-a/README.md' }, null);
    const groupDoc = store.attachDoc({ group: 'group-a' }, { path: 'group-a/CHARTER.md' }, null);
    expect(nodeDoc.ok && projectDoc.ok && groupDoc.ok).toBe(true);
    if (!nodeDoc.ok || !projectDoc.ok || !groupDoc.ok) return;

    db.close();

    const reopenedDb = openDatabase(dbPath);
    try {
      const reopenedStore = new SqlitePortfolioStore(reopenedDb);

      for (const expected of [nodeDoc.data, projectDoc.data, groupDoc.data]) {
        const reloaded = reopenedStore.getDoc(expected.id);
        expect(reloaded).toEqual(expected);
        const ownerArcs = [reloaded?.dagNodeId, reloaded?.projectId, reloaded?.groupId].filter(
          (arc) => arc != null,
        );
        expect(ownerArcs).toHaveLength(1);
      }

      expect(() =>
        reopenedDb
          .prepare('INSERT INTO docs (id, path, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run('doc-zero-owners', 'proj-a/x.md', 'now', 'now'),
      ).toThrow();
      expect(() =>
        reopenedDb
          .prepare(
            `INSERT INTO docs (id, project_id, project_group_id, path, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('doc-two-owners', 'proj-a', 'group-a', 'proj-a/x.md', 'now', 'now'),
      ).toThrow();
    } finally {
      reopenedDb.close();
    }
  });
});
