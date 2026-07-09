# graph-store-sqlite

The durable persistence adapter for the steerable DAG, layered on
`@rad-orchestration/graph-engine`. It ships a single concrete implementation of the engine's
`StateStore` interface (`SqliteStateStore`) backed by `better-sqlite3`, plus `openDatabase` — a
WAL-enabled, foreign-key-enforcing handle factory that migrates a database to the latest schema
on open. The store reproduces `InMemoryStateStore`'s plan-then-commit validation semantics exactly
(validate every node change, then every edge change, then referential integrity of the projected
final state, and only then write), reading current rows to validate instead of a `Map` and
committing nodes, edges, and one `change_log` row inside a single `better-sqlite3` transaction.
Behavioral parity with the in-memory store is not aspirational — it is proven by running the
engine's exported conformance suite (see below).

It also ships `SqlitePortfolioStore` — the CRUD store for the portfolio graph (projects,
worktrees, and the rest of the v2 schema's entities) backed by the same `better-sqlite3` handle.

## Standing conventions

These conventions are enforced from this package's first file and apply to every file added here
going forward:

- **Schema migrations are ordered, additive, and `user_version`-gated.** `src/schema/migrations.ts`
  runs only the migrations newer than the database's current `user_version`, each inside a
  transaction that commits the DDL and the version bump atomically. Never edit an existing
  migration (e.g. `V1_UP`) — append a new `{ version, up }` entry instead, so already-migrated
  databases in the wild stay valid.
- **Behavioral parity with `InMemoryStateStore`.** Any divergence from the in-memory reference
  (e.g. how NULL optional columns round-trip) is a conscious, commented, and tested choice — not
  an accident. The conformance suite is the gate that keeps the two stores substitutable.
- **Decision-traceability.** A non-obvious choice carries an inline comment naming the governing
  design decision in `STEERABLE-DAG-DESIGN`, e.g. `// D8: ...` — matching that design doc's own
  `D<N>` decision numbering.
- **`SqlitePortfolioStore` has its own CRUD interface, not `StateStore`.** Projects, worktrees, and
  the rest of the portfolio graph are host-managed metadata, not execution-DAG state, so there is
  no `ChangeDelta`/`apply` shape here — each portfolio entity gets explicit create/read/update/
  delete methods instead (`portfolio-types.ts`'s `PortfolioStore`).
- **The mutate-and-audit transaction rule.** Every `SqlitePortfolioStore` mutation funnels through
  its private `mutate` helper, which runs the write and one `portfolio_change_log` insert inside a
  single `better-sqlite3` transaction — a failed write rolls back the audit row too, so the
  exactly-one-audit-row-per-mutation invariant holds even under a thrown constraint violation. A
  mutation that writes portfolio data outside `mutate` (skipping the audit) is a defect.
- **Portable paths.** A `worktrees.path` is always stored exactly as given — relative to
  `~/.radorc/worktrees`, POSIX-separated. The store never derives or stores an absolute path;
  `addWorktree` rejects one outright (checked under both the POSIX and Windows conventions,
  regardless of the host OS the process happens to run on).

## Seam rules

- **Consumed only through `src/index.ts`.** The barrel exports exactly `openDatabase`,
  `SqliteStateStore`, `SqlitePortfolioStore`, and their public types; nothing outside this package
  imports internals (`db.ts`, `sqlite-state-store.ts`, `portfolio-store.ts`, `portfolio-types.ts`,
  `schema/migrations.ts`) by path. Tests inside this library may import internals by their direct
  module path.
- **Depends on `@rad-orchestration/graph-engine` by scoped name only**, pinned to the same
  monorepo-lockstep version. It consumes the engine's `StateStore` contract and relational types
  (`DagNode`, `DagEdge`, `ChangeDelta`, `Result`, …) through the engine's barrel, and its tests
  consume the engine's `./testing` conformance harness. Never reach past the engine's own barrel
  into its internals.
- **`better-sqlite3` is a native, synchronous dependency.** Every `db` call is synchronous, so the
  `StateStore` interface needs no async adaptation. On a fresh clone `npm install` fetches
  `better-sqlite3`'s prebuilt binary for the active Node version.
- **Lint is a required gate, not optional.** `npm run lint` (ESLint flat config in
  `eslint.config.js`, modeled on `cli/eslint.config.js`) must pass clean; it enforces
  `consistent-type-imports` and the `^_`-ignore convention for intentionally-unused args/vars.

## Build and distribution

```
npm run build
```

Runs `tsc` and emits a compiled ESM `dist/` tree — `dist/index.js` plus `.d.ts` declarations for
every public export. The `package.json` `exports` map resolves
`@rad-orchestration/graph-store-sqlite` to `dist/index.js` (runtime) and `dist/index.d.ts`
(types).

**Workspace consumption.** The root `package.json` declares this package as a workspace entry
(`lib/graph-store-sqlite`). After a root `npm install`, npm symlinks
`node_modules/@rad-orchestration/graph-store-sqlite` here, and this package resolves
`@rad-orchestration/graph-engine` through its own workspace symlink. Build `graph-engine` before
building or typechecking this package.

## Running tests

```
npm test
```

Runs the vitest suite in `tests/` — including `conformance.test.ts`, which drives the engine's
shared `StateStore` conformance suite (imported from `@rad-orchestration/graph-engine/testing`)
against `SqliteStateStore`, plus `durability.test.ts`, `migrations.test.ts`,
`sqlite-state-store.test.ts`, and `portfolio-store.test.ts`.
