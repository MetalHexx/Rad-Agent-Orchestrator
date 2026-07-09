import type Database from 'better-sqlite3';

interface Migration {
  readonly version: number;
  readonly up: string;
}

const V1_UP = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY
);

CREATE TABLE dag_nodes (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  parent TEXT,
  order_key INTEGER NOT NULL,
  derived_from TEXT,
  disabled INTEGER,
  budget_anchor TEXT,
  data TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);

CREATE TABLE dag_edges (
  project_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (project_id, from_id, to_id, kind)
);

CREATE TABLE change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT,
  primitive TEXT NOT NULL,
  params TEXT NOT NULL,
  node_changes TEXT NOT NULL,
  edge_changes TEXT NOT NULL
);
`;

// Ordered, additive, user_version-gated. Never edit v1 — append new versions instead.
const MIGRATIONS: readonly Migration[] = [{ version: 1, up: V1_UP }];

/**
 * Brings `db` from its current `user_version` up to the latest migration, running only the
 * migrations newer than the current version. Idempotent: re-running against an already-migrated
 * handle is a no-op.
 */
export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      // DDL + version bump commit atomically, so a crash between them can't leave a half-migrated
      // DB whose re-open would re-run this migration against tables that already exist.
      db.transaction(() => {
        db.exec(migration.up);
        db.pragma(`user_version = ${migration.version}`);
      })();
    }
  }
}
