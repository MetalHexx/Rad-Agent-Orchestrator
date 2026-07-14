# graph-service

The deployable host for the steerable DAG: a composition bootstrap that opens the one SQLite
handle and wires the engine, both stores, and the built-in node-type registry into a single
in-process object, plus the Hono HTTP surface later phases build routes onto (`/health` today,
SSE and mutation routes in later tasks).

## Standing conventions

These conventions are enforced from this package's first file and apply to every file added here
going forward:

- **The composition object is the seam.** `compose()` (`src/compose.ts`) builds the one
  `GraphService` — the DB handle, `execStore`, `engine`, `registry`, `portfolio`, `capabilities`,
  `version`, and `dbPath` — that every HTTP handler closes over. A handler reaches state through
  this object, never through a module-level singleton, a second `openDatabase` call, or a fresh
  registry of its own. This package is the single production host and the sole owner of the SQLite
  handle (D9).
- **Barrel-only imports from the three libs.** `@rad-orchestration/graph-engine`,
  `@rad-orchestration/graph-node-types`, and `@rad-orchestration/graph-store-sqlite` are consumed
  exclusively by their scoped package name, through each package's own `src/index.ts` barrel —
  never a deep path (e.g. `@rad-orchestration/graph-store-sqlite/dist/db.js`) into any of their
  internals.
- **Loopback-only.** The daemon (`src/bin/serve.ts`) binds `@hono/node-server`'s `serve()` to
  `127.0.0.1` only. Nothing in this package listens on `0.0.0.0` or any other externally-reachable
  interface — lifecycle/discovery (config-driven ports, PID files, …) is a later phase, but the
  loopback-only bind is a standing invariant from this package's first line, not something a later
  task revisits.
- **Registry-agnostic.** `compose()` feeds the registry the caller-resolved built-in and custom
  node types (`ComposeOptions.builtInNodeTypes` + `customNodeTypes`, both discovered off disk by
  `node-types/scan.ts`'s `discoverNodeTypes`) and never hardcodes an individual type name nor
  imports built-ins from a package — the daemon's `start()` resolves the whole discovery and passes
  both buckets in, so this package depends only on `graph-engine` + `graph-store-sqlite`.
- **Decision-traceability.** A non-obvious choice carries an inline comment naming the governing
  design decision in `STEERABLE-DAG-DESIGN`, e.g. `// D9: ...` — matching that design doc's own
  `D<N>` decision numbering.

## Lifecycle (`ensure`/`start`/`stop`/`status`)

`src/lifecycle/` is how any caller (an agent via the CLI, in a later iteration) guarantees a
running daemon with one cheap call:

- **`ensure()`** (`src/lifecycle/ensure.ts`) is idempotent and fast: a healthy daemon on record is
  reused with no spawn; otherwise exactly one racing caller wins an exclusive-create lockfile
  (`~/.radorc/service.lock`), spawns the daemon **detached**, and polls `/health` until it's green
  (bounded timeout); every other racing caller waits on the same probe instead of spawning its own.
- **`status()`** (`src/lifecycle/ensure.ts`) is read-only: it reports running/endpoint/version from
  a `/health` probe and never spawns or mutates anything.
- **`start()`/`stop()`** (`src/lifecycle/daemon.ts`) are the daemon process's own half: `start()`
  binds loopback-only (falling back to the next free port on `EADDRINUSE`), writes the discovery
  file, and installs the `SIGINT`/`SIGTERM` graceful-shutdown handler (drain the server, close the
  DB handle, remove the discovery file, then exit — a restart always finds a clean slate); `stop()`
  reads the discovery file and signals the pid it names.
- **The discovery file — a public seam.** `~/.radorc/service.json` (`src/lifecycle/discovery.ts`)
  is the one place a running daemon's endpoint is recorded; nothing bakes in a port — the default
  is `1336`, but a bind collision falls back to the next free one and the file records whatever
  actually bound. Shape (kept intentionally minimal):
  ```json
  { "pid": 12345, "port": 1336, "url": "http://127.0.0.1:1336", "startedAt": "2026-07-09T00:00:00.000Z" }
  ```
  Written atomically (temp-write + rename) so a reader never observes a partial file, and removed
  on graceful shutdown. `~/.radorc` is resolved at runtime (`os.homedir()`) — never a path baked
  in at build/install time, so the same code works across machines/users.

## Seam rules

- **Consumed only through `src/index.ts`.** The barrel exports `compose`, `GraphService`,
  `buildApp`, the envelope helpers/types, the capability port bundle (`CapabilityPorts`) and its
  faked implementations (`capabilities/fakes.ts`), and the driver (`capabilities+driver`:
  `advance`/`runToQuiescence`/`resolveViaNodeType`, `applyOutcome`,
  `globalFrontier`/`isGloballyQuiescent`); nothing outside this package imports `compose.ts`,
  `http/*.ts`, `capabilities/*.ts`, or `driver/*.ts` by path. Tests inside this package may import
  internals by their direct module path.
- **The uniform response envelope.** Every route replies `{ ok: true, data }` on success or
  `{ ok: false, error: { code, message } }` on failure — never a thrown, unhandled 500. `src/http/
  respond.ts`'s `ok`/`err`/`fromResult` are the only place this shape is constructed; a route
  builds its body through them instead of hand-rolling the envelope inline.
- **Lint is a required gate, not optional.** `npm run lint` (ESLint flat config in
  `eslint.config.js`, modeled on `cli/eslint.config.js`) must pass clean; it enforces
  `consistent-type-imports` and the `^_`-ignore convention for intentionally-unused args/vars.

## Build and distribution

```
npm run build
```

Runs `tsc` and emits a compiled ESM `dist/` tree — `dist/index.js` plus `.d.ts` declarations for
the public surface, and `dist/bin/serve.js`, the daemon entrypoint the `package.json` `bin` field
points `radorch-graph-service` at.

**Workspace consumption.** The root `package.json` declares this package as a workspace entry
(`graph-service`). After a root `npm install`, npm symlinks
`node_modules/@rad-orchestration/graph-service` here, and this package resolves
`@rad-orchestration/graph-engine`, `@rad-orchestration/graph-node-types`, and
`@rad-orchestration/graph-store-sqlite` through their own workspace symlinks. Build
`graph-engine` → `graph-node-types` → `graph-store-sqlite` before this package typechecks.

## Running tests

```
npm test
```

Runs the vitest suite in `tests/` against `openDatabase(':memory:')` and Hono's in-process
`app.request()` — no socket, no real process spawn.
