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
  type PrimitiveName,
  type ProjectScope,
  type Result,
  type StateStore,
  type Unsubscribe,
} from '@rad-orchestration/graph-engine';

/** Shared read projection for `dag_nodes` — the columns `rowToNode` consumes, in `NodeRow` order. */
const NODE_COLUMNS = 'id, type, status, parent, order_key, derived_from, disabled, budget_anchor, data';

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

/** Named bind values for `upsertNodeStmt` — keys match its `@name` parameters exactly. */
function nodeParams(projectId: string, node: DagNode): Record<string, string | number | null> {
  return {
    project_id: projectId,
    id: node.id,
    type: node.type,
    status: node.status,
    parent: node.parent,
    order_key: node.order,
    derived_from: node.derivedFrom,
    disabled: node.disabled === undefined ? null : node.disabled ? 1 : 0,
    budget_anchor: node.budgetAnchor ?? null,
    data: JSON.stringify(node.data),
  };
}

/** Named bind values shared by the edge exists / upsert / delete statements. */
function edgeParams(
  projectId: string,
  edge: Pick<DagEdge, 'from' | 'to' | 'kind'>,
): Record<string, string> {
  return { project_id: projectId, from_id: edge.from, to_id: edge.to, kind: edge.kind };
}

/**
 * The just-appended `change_log` row, handed to every `subscribe` listener after a successful
 * `apply` commits. `seq`/`project_id` are the identity a `ChangeDelta` alone never carries (`seq`
 * is assigned only at persistence) — D13: this is why the row, not the in-process delta, is what
 * an SSE stream scopes and resumes by. Field names mirror the `change_log` columns verbatim, same
 * as this file's other `*Row` shapes.
 */
export interface ChangeLogRow {
  readonly seq: number;
  readonly project_id: string;
  readonly ts: string;
  readonly actor: string | null;
  readonly primitive: PrimitiveName;
  readonly params: Readonly<Record<string, unknown>>;
  readonly node_changes: readonly NodeChange[];
  readonly edge_changes: readonly EdgeChange[];
}

/** A `SqliteStateStore.subscribe` listener — see {@link ChangeLogRow}. */
export type ChangeLogListener = (row: ChangeLogRow) => void;

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
    (projectId: string, delta: ChangeDelta) => Result<ChangeLogRow>
  >;

  /** Scopes whose `projects` row has been ensured this session — lets reads skip re-seeding work. */
  private readonly seededScopes = new Set<string>();

  // D9: this package is the single production host and sole owner of the SQLite handle, so a
  // row-emission listener registered here is the only observer of every commit — never a second
  // store instance or a poll of the change_log table.
  private readonly changeListeners = new Set<ChangeLogListener>();

  constructor(private readonly db: Database.Database) {
    this.insertProjectStmt = this.db.prepare('INSERT OR IGNORE INTO projects (id) VALUES (?)');
    this.selectNodeStmt = this.db.prepare(
      `SELECT ${NODE_COLUMNS} FROM dag_nodes WHERE project_id = ? AND id = ?`,
    );
    this.selectNodesStmt = this.db.prepare(
      `SELECT ${NODE_COLUMNS} FROM dag_nodes WHERE project_id = ? ORDER BY rowid`,
    );
    this.selectNodeIdsStmt = this.db.prepare('SELECT id FROM dag_nodes WHERE project_id = ?');
    this.nodeExistsStmt = this.db.prepare(
      'SELECT 1 FROM dag_nodes WHERE project_id = ? AND id = ?',
    );
    this.upsertNodeStmt = this.db.prepare(
      `INSERT INTO dag_nodes
         (project_id, id, type, status, parent, order_key, derived_from, disabled, budget_anchor, data)
       VALUES (@project_id, @id, @type, @status, @parent, @order_key, @derived_from, @disabled, @budget_anchor, @data)
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
      'SELECT from_id, to_id, kind FROM dag_edges WHERE project_id = ? ORDER BY rowid',
    );
    this.edgeExistsStmt = this.db.prepare(
      'SELECT 1 FROM dag_edges WHERE project_id = @project_id AND from_id = @from_id AND to_id = @to_id AND kind = @kind',
    );
    this.upsertEdgeStmt = this.db.prepare(
      'INSERT OR REPLACE INTO dag_edges (project_id, from_id, to_id, kind) VALUES (@project_id, @from_id, @to_id, @kind)',
    );
    this.deleteEdgeStmt = this.db.prepare(
      'DELETE FROM dag_edges WHERE project_id = @project_id AND from_id = @from_id AND to_id = @to_id AND kind = @kind',
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
    if (this.seededScopes.has(scope.projectId)) return;
    // Seed the root node only on a scope's genuine first touch — when the `projects` row is newly
    // inserted (`changes === 1`). This matches `InMemoryStateStore`, which seeds root once on first
    // sight and never resurrects an intentionally-emptied scope, and keeps reads from taking a
    // write lock + full COUNT on every call.
    const inserted = this.insertProjectStmt.run(scope.projectId);
    if (inserted.changes === 1) {
      this.upsertNodeStmt.run(nodeParams(scope.projectId, createRootNode()));
    }
    this.seededScopes.add(scope.projectId);
  }

  private nodeExists(projectId: string, id: NodeId): boolean {
    return this.nodeExistsStmt.get(projectId, id) !== undefined;
  }

  private edgeExists(projectId: string, edge: Pick<DagEdge, 'from' | 'to' | 'kind'>): boolean {
    return this.edgeExistsStmt.get(edgeParams(projectId, edge)) !== undefined;
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
   * write, so `applyTransaction` commits nothing rather than needing a rollback. Returns the
   * appended `change_log` row on success, so `apply` can emit it once the transaction commits.
   */
  private commitDelta(projectId: string, delta: ChangeDelta): Result<ChangeLogRow> {
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
      if (mutation.kind === 'set') this.upsertNodeStmt.run(nodeParams(projectId, mutation.node));
      else this.deleteNodeStmt.run(projectId, mutation.id);
    }
    for (const mutation of edgeMutations) {
      const edge = mutation.edge;
      if (mutation.kind === 'set') this.upsertEdgeStmt.run(edgeParams(projectId, edge));
      else this.deleteEdgeStmt.run(edgeParams(projectId, edge));
    }

    // The store is a host component outside the engine's determinism boundary, so a wall-clock
    // timestamp here is fine; `actor` arrives with the service (2.3).
    const ts = new Date().toISOString();
    const info = this.insertChangeLogStmt.run(
      projectId,
      ts,
      null,
      delta.primitive,
      JSON.stringify(delta.params),
      JSON.stringify(delta.nodeChanges),
      JSON.stringify(delta.edgeChanges),
    );

    const row: ChangeLogRow = {
      seq: Number(info.lastInsertRowid),
      project_id: projectId,
      ts,
      actor: null,
      primitive: delta.primitive,
      params: delta.params,
      node_changes: delta.nodeChanges,
      edge_changes: delta.edgeChanges,
    };
    return { ok: true, data: row };
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
    const result = this.applyTransaction(scope.projectId, delta);
    if (!result.ok) return result;
    // Emitted only once `applyTransaction` has returned — i.e. strictly after the transaction's
    // own COMMIT — so a rolled-back delta (which never reaches this line) emits nothing.
    this.emitChangeLogRow(result.data);
    return { ok: true, data: undefined };
  }

  /**
   * Subscribes `listener` to every `change_log` row this store appends from here on, in commit
   * order — additive to `StateStore`, no existing method's behavior changes. Mirrors the engine's
   * `ChangeStream` shape (`subscribe(listener): Unsubscribe`); see {@link ChangeLogRow} for why the
   * persisted row, not a bare `ChangeDelta`, is what gets emitted.
   */
  subscribe(listener: ChangeLogListener): Unsubscribe {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChangeLogRow(row: ChangeLogRow): void {
    // Each listener is isolated: a throwing subscriber must never surface as (or be mistaken for)
    // a failure of the write it's reacting to, which has already committed by this point.
    for (const listener of this.changeListeners) {
      try {
        listener(row);
      } catch {
        // Swallowed — a broadcast failure downstream of the store is the subscriber's problem.
      }
    }
  }
}
