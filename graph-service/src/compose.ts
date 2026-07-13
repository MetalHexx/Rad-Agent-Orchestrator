// graph-service/src/compose.ts
//
// D9: this package is the single production host and the sole owner of the SQLite handle —
// every route/handler reaches the engine, the two stores, and the registry through the one
// `GraphService` object `compose` returns here, never through a module-level singleton or a
// second `openDatabase` call of its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createEngine,
  createNodeTypeRegistry,
  ENGINE_SCHEMA_VERSION,
  type Engine,
  type NodeTypeDefinition,
  type NodeTypeName,
  type NodeTypeRegistry,
} from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { openDatabase, SqlitePortfolioStore, SqliteStateStore } from '@rad-orchestration/graph-store-sqlite';
import type { CapabilityPorts } from './capabilities/ports.js';
import { createRealCapabilityPorts } from './capabilities/real.js';
import type { NodeOutcomeResolver } from './driver/drive.js';
import { createBuiltInResolvers } from './driver/resolvers.js';
import { resolveRadorcRoot } from './lifecycle/discovery.js';

/**
 * The shared services object the whole app closes over — the composition root every route
 * handler is built against instead of reaching for a global or opening its own handle.
 */
export interface GraphService {
  /** The one handle, typed off the barrel so this package never imports `better-sqlite3` directly. */
  readonly db: ReturnType<typeof openDatabase>;
  readonly execStore: SqliteStateStore;
  readonly engine: Engine;
  readonly registry: NodeTypeRegistry;
  readonly portfolio: SqlitePortfolioStore;
  /**
   * The six capability ports the driver dispatches an engaged node's `ActResult` against —
   * `capabilities/real.ts`'s real filesystem-backed `docRead`/`docWrite`, confined to
   * `ComposeOptions.projectRoot`; `gitFacts`/`spawnAgent`/`runCommand`/`requestHuman` still resolve
   * via the fakes (they never fire from this drive loop — the driver stops at any node whose
   * executor would need them, see `driver/drive.ts`'s `runToQuiescence`).
   */
  readonly capabilities: CapabilityPorts;
  /** The per-node-type outcome resolver set (`driver/resolvers.ts`), closed over `capabilities` — what `advance`/`runToQuiescence` dispatch a frontier node's `ActResult` through. */
  readonly resolvers: Readonly<Record<NodeTypeName, NodeOutcomeResolver>>;
  readonly version: { readonly service: string; readonly engine: string };
  readonly dbPath: string;
  // SSE sources: `execStore.subscribe`/`portfolio.subscribe` (P02-T03) — each store's own
  // row-emission hook, reached directly through the fields above rather than a separate wrapper,
  // the same way every other route reaches state through this one composition object.
}

export interface ComposeOptions {
  readonly dbPath: string;
  /**
   * The filesystem root the real `docRead`/`docWrite` ports confine every read/write path to
   * (`createRealCapabilityPorts`'s `projectRoot`). Optional so an in-memory/test `compose()` call
   * never has to supply one — defaults to `resolveRadorcRoot()` (`~/.radorc`), the same root every
   * other lifecycle path in this package resolves at runtime.
   */
  readonly projectRoot?: string;
  /**
   * Discovered custom node types (`node-types/scan.ts`'s `discoverCustomNodeTypes`) to layer over
   * `BUILT_IN_NODE_TYPES`. `compose()` stays synchronous and pure — it never scans the filesystem
   * itself; the caller (`start()`) resolves and passes the list. A reserved-prefix or duplicate
   * custom throws here, at registry construction.
   */
  readonly customNodeTypes?: readonly NodeTypeDefinition[];
}

/** Reads this package's own `version` field — never hardcoded, so it can't drift from `package.json`. */
function readServiceVersion(): string {
  const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string') {
    throw new Error(`missing "version" string in ${packageJsonPath}`);
  }
  return parsed.version;
}

/**
 * Builds the composition root: opens `dbPath`, then wires the execution store, the engine, and
 * the registry over that one handle — `portfolio` is constructed over the same handle so the
 * whole object shares a single SQLite connection.
 *
 * D3/D21 (registry-agnostic): the registry is fed `BUILT_IN_NODE_TYPES` plus whatever
 * `opts.customNodeTypes` the caller resolved — no individual type name is hardcoded here, so
 * `start()`'s discovered custom types slot in with no change to this function.
 *
 * Deliberately does **not** wire `withChangeStream`: its in-process `ChangeDelta` carries no
 * `project_id` and no `seq` (`seq` is assigned only at persistence), so it can't scope a stream or
 * drive resume-by-seq. The SSE sources are `execStore`/`portfolio`'s own row-emission hooks
 * (`subscribe`), which emit the persisted `change_log`/`portfolio_change_log` row instead (D13).
 */
export function compose(opts: ComposeOptions): GraphService {
  const { dbPath, projectRoot = resolveRadorcRoot() } = opts;
  const db = openDatabase(dbPath);
  const execStore = new SqliteStateStore(db);
  const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES, opts.customNodeTypes ?? []);
  const engine = createEngine(execStore, registry);
  const portfolio = new SqlitePortfolioStore(db);
  const capabilities = createRealCapabilityPorts(projectRoot);
  const resolvers = createBuiltInResolvers(capabilities);

  return {
    db,
    execStore,
    engine,
    registry,
    portfolio,
    capabilities,
    resolvers,
    version: { service: readServiceVersion(), engine: ENGINE_SCHEMA_VERSION },
    dbPath,
  };
}
