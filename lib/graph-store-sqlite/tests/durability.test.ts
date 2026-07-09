import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChangeDelta, DagNode } from '@rad-orchestration/graph-engine';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { openDatabase } from '../src/db.js';
import { runMigrations } from '../src/schema/migrations.js';
import { SqliteStateStore } from '../src/sqlite-state-store.js';

const SCOPE = { projectId: 'proj-a' };

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

function addNodeDelta(added: DagNode): ChangeDelta {
  return {
    primitive: 'add_node',
    params: { id: added.id },
    nodeChanges: [{ op: 'created', before: null, after: added }],
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

function tableCount(db: ReturnType<typeof openDatabase>, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

// File-backed cases only — `:memory:` (used by conformance.test.ts) has no restart/reopen story
// and no on-disk file to contend over. Every test gets its own temp directory so parallel test
// files never race on the same path.
describe('SqliteStateStore — durability', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'graph-store-sqlite-durability-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('restart survival', () => {
    it('reloads identical node/edge state after closing and reopening the file-backed db', () => {
      const db = openDatabase(dbPath);
      const store = new SqliteStateStore(db);
      const a = node('task-a');
      const b = node('task-b');
      const applyResult = store.apply(SCOPE, {
        primitive: 'add_node',
        params: {},
        nodeChanges: [
          { op: 'created', before: null, after: a },
          { op: 'created', before: null, after: b },
        ],
        edgeChanges: [{ op: 'created', before: null, after: { from: 'task-a', to: 'task-b', kind: 'depends_on' } }],
      });
      expect(applyResult.ok).toBe(true);

      const nodesBeforeRestart = store.listNodes(SCOPE);
      const edgesBeforeRestart = store.listEdges(SCOPE);

      // Windows/WAL requires the handle fully closed before the file is reopened.
      db.close();

      const reopenedDb = openDatabase(dbPath);
      try {
        const reopenedStore = new SqliteStateStore(reopenedDb);
        expect(reopenedStore.listNodes(SCOPE)).toEqual(nodesBeforeRestart);
        expect(reopenedStore.listEdges(SCOPE)).toEqual(edgesBeforeRestart);
      } finally {
        reopenedDb.close();
      }
    });
  });

  describe('atomic rollback', () => {
    it('leaves node/edge rows and the change_log row count unchanged when a delta is malformed', () => {
      const db = openDatabase(dbPath);
      try {
        const store = new SqliteStateStore(db);
        const seeded = store.apply(SCOPE, addNodeDelta(node('task-a')));
        expect(seeded.ok).toBe(true);

        const nodeCountBefore = tableCount(db, 'dag_nodes');
        const edgeCountBefore = tableCount(db, 'dag_edges');
        const changeLogCountBefore = tableCount(db, 'change_log');

        const result = store.apply(SCOPE, {
          primitive: 'remove_node',
          params: {},
          nodeChanges: [{ op: 'removed', before: node('ghost'), after: null }],
          edgeChanges: [],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('invalid_delta');

        expect(tableCount(db, 'dag_nodes')).toBe(nodeCountBefore);
        expect(tableCount(db, 'dag_edges')).toBe(edgeCountBefore);
        expect(tableCount(db, 'change_log')).toBe(changeLogCountBefore);
      } finally {
        db.close();
      }
    });
  });

  describe('change_log ordering', () => {
    it('records N successful applies as N change_log rows with monotonically increasing seq in application order', () => {
      const db = openDatabase(dbPath);
      try {
        const store = new SqliteStateStore(db);
        const deltas = [
          addNodeDelta(node('task-a')),
          addNodeDelta(node('task-b')),
          addDependencyDelta('task-a', 'task-b'),
        ];

        for (const delta of deltas) {
          const result = store.apply(SCOPE, delta);
          expect(result.ok).toBe(true);
        }

        const rows = db
          .prepare('SELECT seq, primitive FROM change_log ORDER BY seq ASC')
          .all() as Array<{ seq: number; primitive: string }>;

        expect(rows).toHaveLength(deltas.length);
        expect(rows.map((row) => row.primitive)).toEqual(deltas.map((delta) => delta.primitive));
        for (let i = 1; i < rows.length; i++) {
          expect(rows[i].seq).toBeGreaterThan(rows[i - 1].seq);
        }
      } finally {
        db.close();
      }
    });
  });

  describe('migration versioning', () => {
    it('is at the latest user_version after a fresh open, and reopening re-runs nothing', () => {
      const db = openDatabase(dbPath);
      try {
        expect(db.pragma('user_version', { simple: true })).toBe(2);
        expect(() => runMigrations(db)).not.toThrow();
        expect(db.pragma('user_version', { simple: true })).toBe(2);
      } finally {
        db.close();
      }

      const reopenedDb = openDatabase(dbPath);
      try {
        expect(reopenedDb.pragma('user_version', { simple: true })).toBe(2);
      } finally {
        reopenedDb.close();
      }
    });
  });
});
