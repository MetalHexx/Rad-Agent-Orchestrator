import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db.js';
import { runMigrations, V1_UP } from '../src/schema/migrations.js';

const EXPECTED_TABLES = ['projects', 'dag_nodes', 'dag_edges', 'change_log'];
const EXPECTED_PORTFOLIO_TABLES = [
  'project_groups',
  'worktrees',
  'project_edges',
  'external_refs',
  'project_external_refs',
  'docs',
  'portfolio_change_log',
];
const EXPECTED_PORTFOLIO_INDEXES = [
  'idx_project_edges_to_project_id',
  'idx_project_groups_parent_group_id',
  'idx_projects_group_id',
  'idx_external_refs_parent_ref_id',
  'idx_project_external_refs_external_ref_id',
  'idx_docs_dag_node_id',
  'idx_docs_project_id',
  'idx_docs_project_group_id',
  'idx_docs_scope_project_id',
];

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function indexNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function triggerNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function columnNames(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

/** A raw handle seeded with only the v1 (2.1) schema, simulating a pre-existing database. */
function openV1OnlyDatabase(): Database.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(V1_UP);
  db.pragma('user_version = 1');
  return db;
}

describe('openDatabase — migration', () => {
  it('migrates a fresh handle to the latest user_version with the four v1 tables present', () => {
    const db = openDatabase(':memory:');
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(2);
      const names = tableNames(db);
      for (const table of EXPECTED_TABLES) {
        expect(names).toContain(table);
      }
    } finally {
      db.close();
    }
  });

  it('pins the dag_nodes columns, including the order_key rename around the reserved keyword', () => {
    const db = openDatabase(':memory:');
    try {
      expect(columnNames(db, 'dag_nodes')).toEqual([
        'project_id',
        'id',
        'type',
        'status',
        'parent',
        'order_key',
        'derived_from',
        'disabled',
        'budget_anchor',
        'data',
      ]);
      expect(columnNames(db, 'dag_edges')).toEqual(['project_id', 'from_id', 'to_id', 'kind']);
      expect(columnNames(db, 'change_log')).toEqual([
        'seq',
        'project_id',
        'ts',
        'actor',
        'primitive',
        'params',
        'node_changes',
        'edge_changes',
      ]);
    } finally {
      db.close();
    }
  });

  it('enables foreign key enforcement on every open', () => {
    const db = openDatabase(':memory:');
    try {
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      db.close();
    }
  });

  it('is idempotent — re-running migrations on an already-migrated handle changes nothing', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db);
      expect(db.pragma('user_version', { simple: true })).toBe(2);
      const names = tableNames(db);
      for (const table of EXPECTED_TABLES) {
        expect(names).toContain(table);
      }
    } finally {
      db.close();
    }
  });

  describe('file-backed', () => {
    let dir: string;

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('reports journal_mode = wal for a real file path', () => {
      dir = mkdtempSync(join(tmpdir(), 'graph-store-sqlite-'));
      const path = join(dir, 'test.db');
      const db = openDatabase(path);
      try {
        expect(existsSync(path)).toBe(true);
        expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      } finally {
        db.close();
      }
    });
  });

  describe('v2 portfolio schema', () => {
    it('creates every portfolio table, its indexes, and the detach trigger on a fresh open', () => {
      const db = openDatabase(':memory:');
      try {
        const names = tableNames(db);
        for (const table of EXPECTED_PORTFOLIO_TABLES) {
          expect(names).toContain(table);
        }
        const indexes = indexNames(db);
        for (const index of EXPECTED_PORTFOLIO_INDEXES) {
          expect(indexes).toContain(index);
        }
        expect(triggerNames(db)).toContain('trg_detach_docs_on_dag_node_delete');
      } finally {
        db.close();
      }
    });

    it('upgrades a v1-only (2.1) database to v2, adding the portfolio tables without touching v1 data', () => {
      const db = openV1OnlyDatabase();
      try {
        db.prepare('INSERT INTO projects (id) VALUES (?)').run('proj-a');
        expect(db.pragma('user_version', { simple: true })).toBe(1);

        runMigrations(db);

        expect(db.pragma('user_version', { simple: true })).toBe(2);
        const names = tableNames(db);
        for (const table of EXPECTED_PORTFOLIO_TABLES) {
          expect(names).toContain(table);
        }
        expect(db.prepare('SELECT id FROM projects WHERE id = ?').get('proj-a')).toEqual({
          id: 'proj-a',
        });
      } finally {
        db.close();
      }
    });

    it('is a no-op when re-run against an already-v2 database', () => {
      const db = openDatabase(':memory:');
      try {
        expect(() => runMigrations(db)).not.toThrow();
        expect(db.pragma('user_version', { simple: true })).toBe(2);
      } finally {
        db.close();
      }
    });

    it('rejects a docs row with zero owner arcs', () => {
      const db = openDatabase(':memory:');
      try {
        expect(() => db.prepare('INSERT INTO docs (id) VALUES (?)').run('doc-1')).toThrow(
          /CHECK constraint failed/,
        );
      } finally {
        db.close();
      }
    });

    it('rejects a docs row with two owner arcs', () => {
      const db = openDatabase(':memory:');
      try {
        db.prepare('INSERT INTO projects (id) VALUES (?)').run('proj-a');
        db.prepare('INSERT INTO project_groups (id, description) VALUES (?, ?)').run(
          'group-a',
          'a group',
        );
        expect(() =>
          db
            .prepare('INSERT INTO docs (id, project_id, project_group_id) VALUES (?, ?, ?)')
            .run('doc-1', 'proj-a', 'group-a'),
        ).toThrow(/CHECK constraint failed/);
      } finally {
        db.close();
      }
    });

    it('promotes a node-owned doc to its project when the referenced dag_node is deleted', () => {
      const db = openDatabase(':memory:');
      try {
        db.prepare('INSERT INTO projects (id) VALUES (?)').run('proj-a');
        db.prepare(
          `INSERT INTO dag_nodes (project_id, id, type, status, order_key, data)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run('proj-a', 'node-1', 'rad-orc:task', 'not_started', 0, '{}');
        db.prepare(
          'INSERT INTO docs (id, dag_node_id, scope_project_id) VALUES (?, ?, ?)',
        ).run('doc-1', 'node-1', 'proj-a');

        db.prepare('DELETE FROM dag_nodes WHERE project_id = ? AND id = ?').run(
          'proj-a',
          'node-1',
        );

        const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get('doc-1') as {
          project_id: string | null;
          dag_node_id: string | null;
        };
        expect(doc.project_id).toBe('proj-a');
        expect(doc.dag_node_id).toBeNull();
      } finally {
        db.close();
      }
    });

    describe('FK on-delete policies', () => {
      it('cascades worktrees, project_edges, and project_external_refs when their parent project is deleted', () => {
        const db = openDatabase(':memory:');
        try {
          db.prepare('INSERT INTO projects (id) VALUES (?)').run('proj-a');
          db.prepare('INSERT INTO projects (id) VALUES (?)').run('proj-b');
          db.prepare('INSERT INTO worktrees (project_id, repo) VALUES (?, ?)').run(
            'proj-a',
            'rad-orc-source',
          );
          db.prepare(
            'INSERT INTO project_edges (from_project_id, to_project_id, type) VALUES (?, ?, ?)',
          ).run('proj-a', 'proj-b', 'depends_on');
          db.prepare(
            'INSERT INTO external_refs (id, system, external_id) VALUES (?, ?, ?)',
          ).run('ref-1', 'github', 'proj-a');
          db.prepare(
            'INSERT INTO project_external_refs (project_id, external_ref_id) VALUES (?, ?)',
          ).run('proj-a', 'ref-1');

          db.prepare('DELETE FROM projects WHERE id = ?').run('proj-a');

          expect(db.prepare('SELECT COUNT(*) AS c FROM worktrees').get()).toEqual({ c: 0 });
          expect(db.prepare('SELECT COUNT(*) AS c FROM project_edges').get()).toEqual({ c: 0 });
          expect(
            db.prepare('SELECT COUNT(*) AS c FROM project_external_refs').get(),
          ).toEqual({ c: 0 });
        } finally {
          db.close();
        }
      });

      it('nulls projects.group_id, project_groups.parent_group_id, and external_refs.parent_ref_id when their parent is deleted', () => {
        const db = openDatabase(':memory:');
        try {
          db.prepare('INSERT INTO project_groups (id, description) VALUES (?, ?)').run(
            'group-a',
            'a group',
          );
          db.prepare(
            'INSERT INTO project_groups (id, description, parent_group_id) VALUES (?, ?, ?)',
          ).run('group-b', 'b group', 'group-a');
          db.prepare('INSERT INTO projects (id, group_id) VALUES (?, ?)').run(
            'proj-a',
            'group-a',
          );
          db.prepare('INSERT INTO external_refs (id, system, external_id) VALUES (?, ?, ?)').run(
            'ref-1',
            'github',
            'root',
          );
          db.prepare(
            'INSERT INTO external_refs (id, system, external_id, parent_ref_id) VALUES (?, ?, ?, ?)',
          ).run('ref-2', 'github', 'child', 'ref-1');

          db.prepare('DELETE FROM project_groups WHERE id = ?').run('group-a');
          db.prepare('DELETE FROM external_refs WHERE id = ?').run('ref-1');

          expect(
            db.prepare('SELECT group_id FROM projects WHERE id = ?').get('proj-a'),
          ).toEqual({ group_id: null });
          expect(
            db.prepare('SELECT parent_group_id FROM project_groups WHERE id = ?').get('group-b'),
          ).toEqual({ parent_group_id: null });
          expect(
            db.prepare('SELECT parent_ref_id FROM external_refs WHERE id = ?').get('ref-2'),
          ).toEqual({ parent_ref_id: null });
        } finally {
          db.close();
        }
      });

      it('restricts deleting a project that still owns a doc, but nulls a doc.scope_project_id lookup hint', () => {
        const db = openDatabase(':memory:');
        try {
          db.prepare('INSERT INTO projects (id) VALUES (?)').run('proj-a');
          db.prepare('INSERT INTO projects (id) VALUES (?)').run('proj-b');
          db.prepare('INSERT INTO docs (id, project_id, scope_project_id) VALUES (?, ?, ?)').run(
            'doc-1',
            'proj-a',
            'proj-b',
          );

          expect(() => db.prepare('DELETE FROM projects WHERE id = ?').run('proj-a')).toThrow(
            /FOREIGN KEY constraint failed/,
          );

          db.prepare('DELETE FROM projects WHERE id = ?').run('proj-b');
          expect(
            db.prepare('SELECT scope_project_id FROM docs WHERE id = ?').get('doc-1'),
          ).toEqual({ scope_project_id: null });
        } finally {
          db.close();
        }
      });
    });
  });
});
