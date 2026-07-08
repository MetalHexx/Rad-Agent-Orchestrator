import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db.js';
import { runMigrations } from '../src/schema/migrations.js';

const EXPECTED_TABLES = ['projects', 'dag_nodes', 'dag_edges', 'change_log'];

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function columnNames(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

describe('openDatabase — migration', () => {
  it('migrates a fresh handle to user_version 1 with the four tables present', () => {
    const db = openDatabase(':memory:');
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(1);
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
      expect(db.pragma('user_version', { simple: true })).toBe(1);
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
});
