import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChangeDelta, DagNode } from '@rad-orchestration/graph-engine';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { openDatabase } from '../src/db.js';
import { SqlitePortfolioStore } from '../src/portfolio-store.js';
import { SqliteStateStore } from '../src/sqlite-state-store.js';

interface PortfolioChangeLogRow {
  seq: number;
  ts: string;
  actor: string | null;
  operation: string;
  target_type: string;
  target_id: string;
  before: string | null;
  after: string | null;
}

interface ExecChangeLogRow {
  seq: number;
  project_id: string;
  primitive: string;
  node_changes: string;
  edge_changes: string;
}

function portfolioChangeLogRows(db: ReturnType<typeof openDatabase>): PortfolioChangeLogRow[] {
  return db
    .prepare('SELECT * FROM portfolio_change_log ORDER BY seq ASC')
    .all() as PortfolioChangeLogRow[];
}

function execChangeLogRows(db: ReturnType<typeof openDatabase>): ExecChangeLogRow[] {
  return db
    .prepare(
      'SELECT seq, project_id, primitive, node_changes, edge_changes FROM change_log ORDER BY seq ASC',
    )
    .all() as ExecChangeLogRow[];
}

function dagNode(id: string, overrides: Partial<DagNode> = {}): DagNode {
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

function createNodeDelta(node: DagNode): ChangeDelta {
  return {
    primitive: 'add_node',
    params: { id: node.id },
    nodeChanges: [{ op: 'created', before: null, after: node }],
    edgeChanges: [],
  };
}

function addDependencyDelta(from: string, to: string): ChangeDelta {
  return {
    primitive: 'add_dependency',
    params: { from, to },
    nodeChanges: [],
    edgeChanges: [{ op: 'created', before: null, after: { from, to, kind: 'depends_on' } }],
  };
}

// File-backed cases only, mirroring durability.test.ts's rationale: `:memory:` has no
// restart/reopen story. Every test gets its own temp directory so parallel test files never race
// on the same path.
describe('SqlitePortfolioStore — durability', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'graph-store-sqlite-portfolio-durability-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reloads a byte-identical portfolio graph — projects, groups, worktrees, edges, external refs, docs, and the audit log — after closing and reopening the file-backed db, alongside an untouched 2.1 execution graph', () => {
    const db = openDatabase(dbPath);
    const store = new SqlitePortfolioStore(db);
    const nodeStore = new SqliteStateStore(db);
    const scope = { projectId: 'proj-a' };

    store.createGroup({ id: 'root-group', name: 'Root', description: 'Root group' }, 'alice');
    store.createGroup({ id: 'child-group', description: 'Child group' }, 'alice');
    store.setParentGroup('child-group', 'root-group', 'alice');

    store.createProject({ id: 'proj-a', projectType: 'service', status: 'in_progress' }, 'alice');
    store.createProject({ id: 'proj-b' }, 'alice');
    store.createProject({ id: 'proj-c' }, 'alice');
    store.setProjectGroup('proj-a', 'root-group', 'alice');
    store.setProjectGroup('proj-b', 'child-group', 'alice');

    store.addWorktree(
      {
        projectId: 'proj-a',
        repo: 'rad-orc-source',
        path: 'STEERABLE-DAG-2.2/rad-orc-source',
        branch: 'feat/x',
        baseBranch: 'main',
        prUrl: 'https://example.invalid/pr/1',
      },
      'alice',
    );
    store.addWorktree({ projectId: 'proj-b', repo: 'repo-b' }, 'alice');

    store.addEdge('proj-a', 'proj-b', 'follows', 'alice');
    store.addEdge('proj-b', 'proj-c', 'spawned-from', 'alice');

    const parentRef = store.upsertExternalRef(
      { system: 'jira', externalId: 'STORY-1', url: 'https://jira.invalid/STORY-1', refType: 'story' },
      'alice',
    );
    expect(parentRef.ok).toBe(true);
    if (!parentRef.ok) return;
    const childRef = store.upsertExternalRef(
      {
        system: 'jira',
        externalId: 'SUB-1',
        url: 'https://jira.invalid/SUB-1',
        refType: 'subtask',
        parentRefId: parentRef.data.id,
        data: '{"points":3}',
      },
      'alice',
    );
    expect(childRef.ok).toBe(true);
    if (!childRef.ok) return;
    store.linkProjectToRef(
      'proj-a',
      parentRef.data.id,
      { relation: 'implements', isPrimary: true },
      'alice',
    );
    store.linkProjectToRef('proj-c', childRef.data.id, { relation: 'references' }, 'alice');

    const taskA = dagNode('task-a');
    const taskB = dagNode('task-b');
    expect(nodeStore.apply(scope, createNodeDelta(taskA)).ok).toBe(true);
    expect(nodeStore.apply(scope, createNodeDelta(taskB)).ok).toBe(true);
    expect(nodeStore.apply(scope, addDependencyDelta('task-a', 'task-b')).ok).toBe(true);

    const nodeDoc = store.attachDoc(
      { dagNode: { projectId: 'proj-a', nodeId: 'task-a' } },
      { path: 'proj-a/design/task-a.md', docType: 'design' },
      'alice',
    );
    const projectDoc = store.attachDoc(
      { project: 'proj-b' },
      { path: 'proj-b/README.md' },
      'alice',
    );
    const groupDoc = store.attachDoc(
      { group: 'root-group' },
      { path: 'root-group/CHARTER.md' },
      'alice',
    );
    expect(nodeDoc.ok && projectDoc.ok && groupDoc.ok).toBe(true);
    if (!nodeDoc.ok || !projectDoc.ok || !groupDoc.ok) return;

    const before = {
      projects: store.listProjects(),
      rootGroup: store.getGroup('root-group'),
      childGroup: store.getGroup('child-group'),
      rootGroupChildren: store.listGroupChildren('root-group'),
      childGroupChildren: store.listGroupChildren('child-group'),
      worktreesA: store.listWorktrees('proj-a'),
      worktreesB: store.listWorktrees('proj-b'),
      edgesFromA: store.listEdgesFrom('proj-a'),
      edgesToB: store.listEdgesTo('proj-b'),
      edgesFromB: store.listEdgesFrom('proj-b'),
      edgesToC: store.listEdgesTo('proj-c'),
      parentRef: store.getExternalRef(parentRef.data.id),
      childRef: store.getExternalRef(childRef.data.id),
      childRefsOfParent: store.listChildRefs(parentRef.data.id),
      refsForA: store.listRefsForProject('proj-a'),
      refsForC: store.listRefsForProject('proj-c'),
      projectsForParentRef: store.listProjectsForRef(parentRef.data.id),
      nodeDoc: store.getDoc(nodeDoc.data.id),
      projectDoc: store.getDoc(projectDoc.data.id),
      groupDoc: store.getDoc(groupDoc.data.id),
      docsForProjectA: store.listDocsForProject('proj-a'),
      docsForProjectB: store.listDocsForProject('proj-b'),
      docsForOwnerGroup: store.listDocsForOwner({ group: 'root-group' }),
      portfolioChangeLog: portfolioChangeLogRows(db),
      execNodes: nodeStore.listNodes(scope),
      execEdges: nodeStore.listEdges(scope),
      execChangeLog: execChangeLogRows(db),
    };

    // Windows/WAL requires the handle fully closed before the file is reopened.
    db.close();

    const reopenedDb = openDatabase(dbPath);
    try {
      const reopenedStore = new SqlitePortfolioStore(reopenedDb);
      const reopenedNodeStore = new SqliteStateStore(reopenedDb);

      expect(reopenedStore.listProjects()).toEqual(before.projects);
      expect(reopenedStore.getGroup('root-group')).toEqual(before.rootGroup);
      expect(reopenedStore.getGroup('child-group')).toEqual(before.childGroup);
      expect(reopenedStore.listGroupChildren('root-group')).toEqual(before.rootGroupChildren);
      expect(reopenedStore.listGroupChildren('child-group')).toEqual(before.childGroupChildren);
      expect(reopenedStore.listWorktrees('proj-a')).toEqual(before.worktreesA);
      expect(reopenedStore.listWorktrees('proj-b')).toEqual(before.worktreesB);
      expect(reopenedStore.listEdgesFrom('proj-a')).toEqual(before.edgesFromA);
      expect(reopenedStore.listEdgesTo('proj-b')).toEqual(before.edgesToB);
      expect(reopenedStore.listEdgesFrom('proj-b')).toEqual(before.edgesFromB);
      expect(reopenedStore.listEdgesTo('proj-c')).toEqual(before.edgesToC);
      expect(reopenedStore.getExternalRef(parentRef.data.id)).toEqual(before.parentRef);
      expect(reopenedStore.getExternalRef(childRef.data.id)).toEqual(before.childRef);
      expect(reopenedStore.listChildRefs(parentRef.data.id)).toEqual(before.childRefsOfParent);
      expect(reopenedStore.listRefsForProject('proj-a')).toEqual(before.refsForA);
      expect(reopenedStore.listRefsForProject('proj-c')).toEqual(before.refsForC);
      expect(reopenedStore.listProjectsForRef(parentRef.data.id)).toEqual(before.projectsForParentRef);
      expect(reopenedStore.getDoc(nodeDoc.data.id)).toEqual(before.nodeDoc);
      expect(reopenedStore.getDoc(projectDoc.data.id)).toEqual(before.projectDoc);
      expect(reopenedStore.getDoc(groupDoc.data.id)).toEqual(before.groupDoc);
      expect(reopenedStore.listDocsForProject('proj-a')).toEqual(before.docsForProjectA);
      expect(reopenedStore.listDocsForProject('proj-b')).toEqual(before.docsForProjectB);
      expect(reopenedStore.listDocsForOwner({ group: 'root-group' })).toEqual(before.docsForOwnerGroup);
      expect(portfolioChangeLogRows(reopenedDb)).toEqual(before.portfolioChangeLog);

      // The 2.1 execution store shares the same file — a portfolio-heavy schema and a full
      // portfolio round trip must not disturb its own durability story.
      expect(reopenedNodeStore.listNodes(scope)).toEqual(before.execNodes);
      expect(reopenedNodeStore.listEdges(scope)).toEqual(before.execEdges);
      expect(execChangeLogRows(reopenedDb)).toEqual(before.execChangeLog);
    } finally {
      reopenedDb.close();
    }
  });
});
