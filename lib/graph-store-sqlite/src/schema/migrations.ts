import type Database from 'better-sqlite3';

interface Migration {
  readonly version: number;
  readonly up: string;
}

export const V1_UP = `
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

// The portfolio schema: project_groups/worktrees/project_edges/external_refs/docs alongside 2.1's
// execution tables (dag_nodes/dag_edges/change_log, untouched above). project_groups is created
// before the projects ALTER that references it, since SQLite validates FK targets at ALTER time.
const V2_UP = `
CREATE TABLE project_groups (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT NOT NULL,
  parent_group_id TEXT REFERENCES project_groups(id) ON DELETE SET NULL,
  created_at TEXT,
  updated_at TEXT
);

-- ADD COLUMN cannot add a NOT NULL constraint without a constant default, so every enrichment
-- column here is nullable; group_id's REFERENCES is allowed only because its default is NULL.
ALTER TABLE projects ADD COLUMN project_type TEXT;
ALTER TABLE projects ADD COLUMN status TEXT;
ALTER TABLE projects ADD COLUMN group_id TEXT REFERENCES project_groups(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN auto_commit INTEGER;
ALTER TABLE projects ADD COLUMN auto_pr INTEGER;
ALTER TABLE projects ADD COLUMN source_control_initialized INTEGER;
ALTER TABLE projects ADD COLUMN created_at TEXT;
ALTER TABLE projects ADD COLUMN updated_at TEXT;

CREATE TABLE worktrees (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  path TEXT,
  branch TEXT,
  base_branch TEXT,
  pr_url TEXT,
  PRIMARY KEY (project_id, repo)
);

CREATE TABLE project_edges (
  from_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  to_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  PRIMARY KEY (from_project_id, to_project_id, type)
);

CREATE TABLE external_refs (
  id TEXT PRIMARY KEY,
  system TEXT,
  external_id TEXT,
  url TEXT,
  ref_type TEXT,
  parent_ref_id TEXT REFERENCES external_refs(id) ON DELETE SET NULL,
  data TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE (system, external_id)
);

CREATE TABLE project_external_refs (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_ref_id TEXT NOT NULL REFERENCES external_refs(id) ON DELETE CASCADE,
  relation TEXT,
  is_primary INTEGER,
  PRIMARY KEY (project_id, external_ref_id)
);

-- docs.dag_node_id is a plain column (no REFERENCES): dag_nodes' PK is the composite
-- (project_id, id), so a single-column FK can't target it, and insert-time integrity is validated
-- in the store (P03-T01) instead. The CHECK enforces exactly one owner arc; project_id/
-- project_group_id are the owning arcs (RESTRICT — never silently orphan an owned doc), while
-- scope_project_id is only a lookup hint for the detach trigger below (SET NULL is safe; CASCADE
-- would silently destroy the project's own doc rows).
CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  dag_node_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  project_group_id TEXT REFERENCES project_groups(id) ON DELETE RESTRICT,
  scope_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  path TEXT,
  doc_type TEXT,
  created_at TEXT,
  updated_at TEXT,
  CHECK ((dag_node_id IS NOT NULL) + (project_id IS NOT NULL) + (project_group_id IS NOT NULL) = 1)
);

CREATE TABLE portfolio_change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  actor TEXT,
  operation TEXT,
  target_type TEXT,
  target_id TEXT,
  before TEXT,
  after TEXT
);

-- SQLite does not auto-index FK columns; these support the bidirectional-traversal set only (the
-- "from"/"project_id"-first side of each composite PK is already covered by that PK's own index).
CREATE INDEX idx_project_edges_to_project_id ON project_edges(to_project_id);
CREATE INDEX idx_project_groups_parent_group_id ON project_groups(parent_group_id);
CREATE INDEX idx_projects_group_id ON projects(group_id);
CREATE INDEX idx_external_refs_parent_ref_id ON external_refs(parent_ref_id);
CREATE INDEX idx_project_external_refs_external_ref_id ON project_external_refs(external_ref_id);
CREATE INDEX idx_docs_dag_node_id ON docs(dag_node_id);
CREATE INDEX idx_docs_project_id ON docs(project_id);
CREATE INDEX idx_docs_project_group_id ON docs(project_group_id);
CREATE INDEX idx_docs_scope_project_id ON docs(scope_project_id);

-- A node-owned doc's only owner arc is dag_node_id, so nulling it on node delete would leave zero
-- owner arcs and fail the CHECK above, aborting the engine's DELETE FROM dag_nodes (the engine
-- never calls portfolio code, so this must live at the DDL level). Promoting the doc to its
-- project instead keeps exactly one owner arc satisfied, and is inert when no docs reference the
-- deleted node.
CREATE TRIGGER trg_detach_docs_on_dag_node_delete
AFTER DELETE ON dag_nodes
BEGIN
  UPDATE docs SET project_id = scope_project_id, dag_node_id = NULL
  WHERE dag_node_id = OLD.id AND scope_project_id = OLD.project_id;
END;
`;

// Ordered, additive, user_version-gated. Never edit v1 — append new versions instead.
const MIGRATIONS: readonly Migration[] = [
  { version: 1, up: V1_UP },
  { version: 2, up: V2_UP },
];

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
