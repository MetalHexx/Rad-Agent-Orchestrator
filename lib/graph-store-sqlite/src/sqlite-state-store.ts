import type Database from 'better-sqlite3';
import {
  assertNever,
  createRootNode,
  type ChangeDelta,
  type DagEdge,
  type DagNode,
  type EdgeChange,
  type NodeChange,
  type NodeId,
  type ProjectScope,
  type Result,
  type StateStore,
} from '@rad-orchestration/graph-engine';

interface NodeRow {
  id: string;
  type: string;
  status: string;
  parent: string | null;
  order_key: number;
  derived_from: string | null;
  disabled: number | null;
  budget_anchor: string | null;
  data: string;
}

interface EdgeRow {
  from_id: string;
  to_id: string;
  kind: string;
}

type NodeMutation =
  | { readonly kind: 'set'; readonly node: DagNode }
  | { readonly kind: 'delete'; readonly id: NodeId };

type EdgeMutation =
  | { readonly kind: 'set'; readonly edge: DagEdge }
  | { readonly kind: 'delete'; readonly edge: DagEdge };

function edgeKey(edge: Pick<DagEdge, 'from' | 'to' | 'kind'>): string {
  return `${edge.kind}:${edge.from}->${edge.to}`;
}

function invalidDelta(message: string): Result<never> {
  return { ok: false, error: { code: 'invalid_delta', message } };
}

function rowToNode(row: NodeRow): DagNode {
  const node: DagNode = {
    id: row.id,
    type: row.type as DagNode['type'],
    status: row.status as DagNode['status'],
    parent: row.parent,
    order: row.order_key,
    derivedFrom: row.derived_from,
    data: JSON.parse(row.data) as Record<string, unknown>,
  };
  // NULL columns round-trip as *absent* keys, not `null`/`undefined` present — parity with
  // conformance nodes, which never carry these optional fields at all. This also collapses a
  // present-and-explicit-null `budgetAnchor` (the shape `crud.ts`'s remove_node survivor-scrub
  // writes) into absent on read, diverging from `InMemoryStateStore`'s exact-identity round-trip.
  // A conscious, tested choice (`sqlite-state-store.test.ts`'s "optional field round-trip" block):
  // every current reader treats absent and null identically (`?? null` / `!= null`), so the
  // collapse carries no live behavioral gap.
  if (row.disabled !== null) node.disabled = row.disabled === 1;
  if (row.budget_anchor !== null) node.budgetAnchor = row.budget_anchor;
  return node;
}

function rowToEdge(row: EdgeRow): DagEdge {
  return { from: row.from_id, to: row.to_id, kind: row.kind as DagEdge['kind'] };
}

/** Positional bind values for `upsertNodeStmt`, matching its column order exactly. */
function nodeParams(projectId: string, node: DagNode): unknown[] {
  return [
    projectId,
    node.id,
    node.type,
    node.status,
    node.parent,
    node.order,
    node.derivedFrom,
    node.disabled === undefined ? null : node.disabled ? 1 : 0,
    node.budgetAnchor ?? null,
    JSON.stringify(node.data),
  ];
}

/**
 * The durable `StateStore` over the P01 schema. Every `db` operation is synchronous
 * (better-sqlite3), so `StateStore`'s interface needs no adaptation. Each `scope.projectId` is
 * seeded on first touch — a `projects` row plus, if the scope has zero nodes, the project-scoped
 * root anchor — so `listNodes` on a brand-new scope always returns exactly the root, matching
 * `InMemoryStateStore`.
 *
 * `apply` reproduces the in-memory store's plan-then-commit validation (`lib/graph-engine/src/
 * store/in-memory-store.ts`) exactly, reading current rows to validate instead of a `Map`, and
 * commits nodes, edges, and one `change_log` row inside a single `db.transaction()`. A malformed
 * delta returns before any write happens, so the transaction commits nothing rather than being
 * rolled back — the store is left byte-for-byte as it was.
 */
export class SqliteStateStore implements StateStore {
  private readonly insertProjectStmt: Database.Statement;
  private readonly countNodesStmt: Database.Statement;
  private readonly selectNodeStmt: Database.Statement;
  private readonly selectNodesStmt: Database.Statement;
  private readonly selectNodeIdsStmt: Database.Statement;
  private readonly nodeExistsStmt: Database.Statement;
  private readonly upsertNodeStmt: Database.Statement;
  private readonly deleteNodeStmt: Database.Statement;
  private readonly selectEdgesStmt: Database.Statement;
  private readonly edgeExistsStmt: Database.Statement;
  private readonly upsertEdgeStmt: Database.Statement;
  private readonly deleteEdgeStmt: Database.Statement;
  private readonly insertChangeLogStmt: Database.Statement;
  private readonly applyTransaction: Database.Transaction<
    (projectId: string, delta: ChangeDelta) => Result<void>
  >;

  constructor(private readonly db: Database.Database) {
    this.insertProjectStmt = this.db.prepare('INSERT OR IGNORE INTO projects (id) VALUES (?)');
    this.countNodesStmt = this.db.prepare(
      'SELECT COUNT(*) AS count FROM dag_nodes WHERE project_id = ?',
    );
    this.selectNodeStmt = this.db.prepare(
      `SELECT id, type, status, parent, order_key, derived_from, disabled, budget_anchor, data
       FROM dag_nodes WHERE project_id = ? AND id = ?`,
    );
    this.selectNodesStmt = this.db.prepare(
      `SELECT id, type, status, parent, order_key, derived_from, disabled, budget_anchor, data
       FROM dag_nodes WHERE project_id = ?`,
    );
    this.selectNodeIdsStmt = this.db.prepare('SELECT id FROM dag_nodes WHERE project_id = ?');
    this.nodeExistsStmt = this.db.prepare(
      'SELECT 1 FROM dag_nodes WHERE project_id = ? AND id = ?',
    );
    this.upsertNodeStmt = this.db.prepare(
      `INSERT INTO dag_nodes
         (project_id, id, type, status, parent, order_key, derived_from, disabled, budget_anchor, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, id) DO UPDATE SET
         type = excluded.type,
         status = excluded.status,
         parent = excluded.parent,
         order_key = excluded.order_key,
         derived_from = excluded.derived_from,
         disabled = excluded.disabled,
         budget_anchor = excluded.budget_anchor,
         data = excluded.data`,
    );
    this.deleteNodeStmt = this.db.prepare('DELETE FROM dag_nodes WHERE project_id = ? AND id = ?');
    this.selectEdgesStmt = this.db.prepare(
      'SELECT from_id, to_id, kind FROM dag_edges WHERE project_id = ?',
    );
    this.edgeExistsStmt = this.db.prepare(
      'SELECT 1 FROM dag_edges WHERE project_id = ? AND from_id = ? AND to_id = ? AND kind = ?',
    );
    this.upsertEdgeStmt = this.db.prepare(
      'INSERT OR REPLACE INTO dag_edges (project_id, from_id, to_id, kind) VALUES (?, ?, ?, ?)',
    );
    this.deleteEdgeStmt = this.db.prepare(
      'DELETE FROM dag_edges WHERE project_id = ? AND from_id = ? AND to_id = ? AND kind = ?',
    );
    this.insertChangeLogStmt = this.db.prepare(
      `INSERT INTO change_log (project_id, ts, actor, primitive, params, node_changes, edge_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.applyTransaction = this.db.transaction((projectId: string, delta: ChangeDelta) =>
      this.commitDelta(projectId, delta),
    );
  }

  private ensureSeeded(scope: ProjectScope): void {
    this.insertProjectStmt.run(scope.projectId);
    const { count } = this.countNodesStmt.get(scope.projectId) as { count: number };
    if (count === 0) {
      this.upsertNodeStmt.run(...nodeParams(scope.projectId, createRootNode()));
    }
  }

  private nodeExists(projectId: string, id: NodeId): boolean {
    return this.nodeExistsStmt.get(projectId, id) !== undefined;
  }

  private edgeExists(projectId: string, edge: Pick<DagEdge, 'from' | 'to' | 'kind'>): boolean {
    return this.edgeExistsStmt.get(projectId, edge.from, edge.to, edge.kind) !== undefined;
  }

  private planNodeChange(projectId: string, change: NodeChange): Result<NodeMutation> {
    switch (change.op) {
      case 'created': {
        if (!change.after) return invalidDelta(`a 'created' node change requires 'after'`);
        if (this.nodeExists(projectId, change.after.id)) {
          return invalidDelta(`node '${change.after.id}' already exists`);
        }
        return { ok: true, data: { kind: 'set', node: change.after } };
      }
      case 'updated': {
        if (!change.before || !change.after) {
          return invalidDelta(`an 'updated' node change requires 'before' and 'after'`);
        }
        if (change.before.id !== change.after.id) {
          return invalidDelta(
            `an 'updated' node change cannot change id ('${change.before.id}' -> '${change.after.id}')`,
          );
        }
        if (!this.nodeExists(projectId, change.before.id)) {
          return invalidDelta(`node '${change.before.id}' does not exist`);
        }
        return { ok: true, data: { kind: 'set', node: change.after } };
      }
      case 'removed': {
        if (!change.before) return invalidDelta(`a 'removed' node change requires 'before'`);
        if (!this.nodeExists(projectId, change.before.id)) {
          return invalidDelta(`node '${change.before.id}' does not exist`);
        }
        return { ok: true, data: { kind: 'delete', id: change.before.id } };
      }
      default:
        return assertNever(change.op);
    }
  }

  private planEdgeChange(projectId: string, change: EdgeChange): Result<EdgeMutation> {
    switch (change.op) {
      case 'created': {
        if (!change.after) return invalidDelta(`a 'created' edge change requires 'after'`);
        if (this.edgeExists(projectId, change.after)) {
          return invalidDelta(`edge '${edgeKey(change.after)}' already exists`);
        }
        return { ok: true, data: { kind: 'set', edge: change.after } };
      }
      case 'updated': {
        if (!change.before || !change.after) {
          return invalidDelta(`an 'updated' edge change requires 'before' and 'after'`);
        }
        const beforeKey = edgeKey(change.before);
        const afterKey = edgeKey(change.after);
        if (beforeKey !== afterKey) {
          return invalidDelta(
            `an 'updated' edge change cannot change identity ('${beforeKey}' -> '${afterKey}')`,
          );
        }
        if (!this.edgeExists(projectId, change.before)) {
          return invalidDelta(`edge '${beforeKey}' does not exist`);
        }
        return { ok: true, data: { kind: 'set', edge: change.after } };
      }
      case 'removed': {
        if (!change.before) return invalidDelta(`a 'removed' edge change requires 'before'`);
        if (!this.edgeExists(projectId, change.before)) {
          return invalidDelta(`edge '${edgeKey(change.before)}' does not exist`);
        }
        return { ok: true, data: { kind: 'delete', edge: change.before } };
      }
      default:
        return assertNever(change.op);
    }
  }

  /**
   * Rejects a delta whose post-commit state would leave an edge referencing a node id that isn't
   * (or is no longer) in the scope. No cascade: a delta removing a node with live edges must
   * remove those edges itself. Checked against the *full* current node/edge sets (not just the
   * changed ones), since an edge the delta never touches can still dangle if its node is removed.
   */
  private checkReferentialIntegrity(
    projectId: string,
    nodeMutations: readonly NodeMutation[],
    edgeMutations: readonly EdgeMutation[],
  ): Result<void> {
    const nodeIds = new Set(
      (this.selectNodeIdsStmt.all(projectId) as Array<{ id: string }>).map((row) => row.id),
    );
    for (const mutation of nodeMutations) {
      if (mutation.kind === 'set') nodeIds.add(mutation.node.id);
      else nodeIds.delete(mutation.id);
    }

    const edges = new Map<string, DagEdge>();
    for (const row of this.selectEdgesStmt.all(projectId) as EdgeRow[]) {
      const edge = rowToEdge(row);
      edges.set(edgeKey(edge), edge);
    }
    for (const mutation of edgeMutations) {
      if (mutation.kind === 'set') edges.set(edgeKey(mutation.edge), mutation.edge);
      else edges.delete(edgeKey(mutation.edge));
    }

    for (const edge of edges.values()) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        return invalidDelta(
          `edge '${edgeKey(edge)}' references a node that does not exist ('${edge.from}' -> '${edge.to}')`,
        );
      }
    }
    return { ok: true, data: undefined };
  }

  /**
   * Validates every node change then every edge change against current rows, checks referential
   * integrity of the projected final state, and only then writes nodes, edges, and the
   * `change_log` row — in that order. Returning early on an invalid delta happens before any
   * write, so `applyTransaction` commits nothing rather than needing a rollback.
   */
  private commitDelta(projectId: string, delta: ChangeDelta): Result<void> {
    const nodeMutations: NodeMutation[] = [];
    for (const change of delta.nodeChanges) {
      const planned = this.planNodeChange(projectId, change);
      if (!planned.ok) return planned;
      nodeMutations.push(planned.data);
    }

    const edgeMutations: EdgeMutation[] = [];
    for (const change of delta.edgeChanges) {
      const planned = this.planEdgeChange(projectId, change);
      if (!planned.ok) return planned;
      edgeMutations.push(planned.data);
    }

    const integrity = this.checkReferentialIntegrity(projectId, nodeMutations, edgeMutations);
    if (!integrity.ok) return integrity;

    for (const mutation of nodeMutations) {
      if (mutation.kind === 'set') this.upsertNodeStmt.run(...nodeParams(projectId, mutation.node));
      else this.deleteNodeStmt.run(projectId, mutation.id);
    }
    for (const mutation of edgeMutations) {
      const edge = mutation.edge;
      if (mutation.kind === 'set') this.upsertEdgeStmt.run(projectId, edge.from, edge.to, edge.kind);
      else this.deleteEdgeStmt.run(projectId, edge.from, edge.to, edge.kind);
    }

    // The store is a host component outside the engine's determinism boundary, so a wall-clock
    // timestamp here is fine; `actor` arrives with the service (2.3).
    this.insertChangeLogStmt.run(
      projectId,
      new Date().toISOString(),
      null,
      delta.primitive,
      JSON.stringify(delta.params),
      JSON.stringify(delta.nodeChanges),
      JSON.stringify(delta.edgeChanges),
    );

    return { ok: true, data: undefined };
  }

  getNode(scope: ProjectScope, id: NodeId): DagNode | null {
    this.ensureSeeded(scope);
    const row = this.selectNodeStmt.get(scope.projectId, id) as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  listNodes(scope: ProjectScope): DagNode[] {
    this.ensureSeeded(scope);
    return (this.selectNodesStmt.all(scope.projectId) as NodeRow[]).map(rowToNode);
  }

  listEdges(scope: ProjectScope): DagEdge[] {
    this.ensureSeeded(scope);
    return (this.selectEdgesStmt.all(scope.projectId) as EdgeRow[]).map(rowToEdge);
  }

  apply(scope: ProjectScope, delta: ChangeDelta): Result<void> {
    this.ensureSeeded(scope);
    return this.applyTransaction(scope.projectId, delta);
  }
}
