# work-graph

The single backend for the work-graph CLI now and the dashboard UI later.

## Derive, don't duplicate

Only Groups and Edges are persisted. Everything else is derived live at read time and never written to disk.

| What | Where it lives | How it arrives |
|------|----------------|----------------|
| Groups | `~/.radorc/work-graph.yml` (`groups` map) | Stored — only the library (via `GraphIndex`) touches this file |
| Edges | `~/.radorc/work-graph.yml` (`edges` list) | Stored — same |
| Projects | `~/.radorc/projects/<id>/` directories | Derived from the filesystem at every read via `deriveProject` |
| Node status | `~/.radorc/projects/<id>/state.json` | Derived read-only from `state.json`; the library never writes it |
| Active set / worktree paths | Git worktree metadata, convention paths, or a shared `worktree_name` | Derived live via `resolveWorktrees`; never persisted |

### Worktree resolution

`resolveWorktrees` derives a project's worktrees live and never persists them. Four resolution kinds are supported:

- **`convention`**: The `worktree_name` defaults to the project's own folder name; under the multi-repo `source_control.repos[]` convention each repo resolves to `worktrees/<worktree_name>/<repo>/`.
- **`shared-worktree-name`**: A child project running inside a parent's worktree derives a shared `worktree_name` read from `state.pipeline.source_control` (never stored). When that shared name is a non-empty string that differs from the project's own folder name, the refs resolve under the shared path.
- **`git`**: A legacy single `worktree_path` resolves via git metadata.
- **`registry-clone`**: A binding to a main-clone repo registered in the repository registry, resolved via the registry's configured path.

## Seam rules

- **Only `GraphIndex` touches `work-graph.yml`.** No consumer outside this library reads or writes the store directly.
- **CLI and UI consume `WorkGraphService`.** They call the service methods; they never reach into `GraphIndex`, `WorkGraph`, or the derive helpers directly.
- **`state.json` is read-only.** This library reads `state.json` to derive project status. It never writes, migrates, or locks it.
- **Consumed only through the facade-only `src/index.ts` barrel.** The public barrel exports exactly `WorkGraphService`, `ServiceOpts`, and the public type vocabulary (`Node`/`Group`/`Project`/`Edge`/`GraphDTO`/`WorktreeRef`/`Result`/`WorkGraphError`/`WorkGraphErrorCode`/etc.) plus the `PROJECTION_SCHEMA` constant. It never re-exports the backing store, graph, derive, validate, reconcile, or id internals, so no consumer can bypass the facade. Never import from internal modules (`store.js`, `graph.js`, `derive/*.js`, etc.) outside of this library — tests inside this library may import internals by their direct module path.

## API surface

### Read

| Method | Signature | Description |
|--------|-----------|-------------|
| `getGraph` | `(scope?: { rootId?: NodeId; depth?: number }) => GraphDTO` | Returns the full `work-graph/v1` JSON projection; optionally scoped to a subtree |
| `getNode` | `(id: NodeId) => Node \| null` | Looks up a single node (project or group) by id |
| `listProjects` | `(filter?: { groupId?: NodeId; status?: NodeStatus }) => Project[]` | Lists all derived projects, with optional status or group membership filter |
| `listGroups` | `() => Group[]` | Lists all stored groups |
| `resolveWorktrees` | `(projectId: NodeId) => WorktreeRef[]` | Resolves worktree paths for a project via convention, shared-worktree-name, git, or registry-clone |

### Structure write

Every write method returns a `Result<T>` — a `{ ok: true; data: T }` on success or a
`{ ok: false; error: WorkGraphError }` on an expected domain failure (see [Error contract](#error-contract)).

| Method | Signature | Description |
|--------|-----------|-------------|
| `createGroup` | `(input: { name: string; description: string; parentId?: NodeId }) => Result<{ node: Group; rev: number }>` | Creates a new group; optionally nests it under a parent via a `contains` edge |
| `updateGroup` | `(id: NodeId, patch: { name?: string; description?: string }) => Result<{ node: Group; rev: number }>` | Updates a group's name or description |
| `deleteGroup` | `(id: NodeId) => Result<{ rev: number }>` | Deletes a group and cascades its `contains` edges; projects are never deleted |
| `addMember` | `(groupId: NodeId, nodeId: NodeId) => Result<{ edge: Edge; rev: number }>` | Adds a `contains` edge from group to node |
| `removeMember` | `(groupId: NodeId, nodeId: NodeId) => Result<{ rev: number }>` | Removes the `contains` edge between group and node |
| `link` | `(from: NodeId, to: NodeId, type: EdgeType) => Result<{ edge: Edge; rev: number }>` | Adds an arbitrary typed edge |
| `unlink` | `(from: NodeId, to: NodeId, type: EdgeType) => Result<{ rev: number }>` | Removes an arbitrary typed edge |

### Maintenance

| Method | Signature | Description |
|--------|-----------|-------------|
| `prune` | `() => Result<{ removed: Edge[]; rev: number }>` | Removes edges whose `from` or `to` node no longer exists; no-op if nothing to remove |

## The `work-graph/v1` projection

`getGraph` returns a `GraphDTO` object that is the versioned consumer boundary — the shape CLI commands and the UI receive:

```ts
interface GraphDTO {
  schema: 'work-graph/v1'; // PROJECTION_SCHEMA constant
  nodes: Node[];            // groups + derived projects
  edges: Edge[];            // active edges (both endpoints exist)
  danglingEdges: Edge[];    // edges whose endpoint was not found in this read
}
```

`danglingEdges` is surfaced for diagnostic display; it is never silently dropped. Consumers should treat `schema` as a version discriminant and reject unrecognised values.

## Validation invariants

| Invariant | Where enforced |
|-----------|----------------|
| Referential integrity — both edge endpoints must exist at write time | `validateNewEdge` |
| No duplicate edges — same `(type, from, to)` triple is rejected | `validateNewEdge` |
| Single-parent containment — a node may have at most one `contains` parent | `validateNewEdge` |
| Acyclic containment — a `contains` edge that would form a cycle is rejected | `validateNewEdge` |
| Unique group ids — derived from `slugify(name)`; a collision is a `validation` rejection | `validateNewGroupId` |
| Overlay-only writes — projects are never created or deleted through the service | `WorkGraphService` (by design; no create/delete project methods) |
| Edge-type leniency — only `contains` edges are structurally constrained; other edge types (`spawned-from`, `follows`, and open-ended string types) are stored as-is | `validateNewEdge` |

`validateNewEdge` and `validateNewGroupId` return a `WorkGraphError | null` — `null` when the
candidate is acceptable, otherwise a `{ code: 'validation', message }` describing the rejection.

## Error contract

Expected domain failures are returned as **values**, not thrown, so every consumer (CLI today, a
UI/server later) handles them explicitly and no partial write is ever persisted.

- **Write methods return `Result<T>`** — `{ ok: true; data: T }` on success, or
  `{ ok: false; error: WorkGraphError }` on an expected domain failure.
- **`error.code`** is `'validation'` (a rejected invariant, empty description, or missing-group
  guard) or `'stale_revision'` (a compare-and-swap conflict in `GraphIndex.write`, which writes
  nothing).
- **Only genuine I/O faults throw** — an unreadable/corrupt `work-graph.yml` parse, or a filesystem
  temp-write / rename failure. No caller can recover from these, so they propagate as exceptions
  rather than `Result` values.
- **Read methods are unaffected** — they never produce domain failures and do not return `Result`.

For architecture depth — layering diagram, reconcile strategy, store format evolution — refer to the Technical Design document rather than this orientation file.

## Build and distribution

```
npm run build
```

This runs `tsc` and emits a compiled ESM `dist/` tree — `dist/index.js` (the module entry) plus `.d.ts` type declarations for every public export. The `package.json` `exports` map resolves `@rad-orchestration/work-graph` to `dist/index.js` (runtime) and `dist/index.d.ts` (types).

**Workspace consumption.** The root `package.json` declares this package as a workspace entry (`lib/work-graph`). After a root `npm install`, npm creates a symlink at `node_modules/@rad-orchestration/work-graph` pointing here. Consumers — the CLI and the UI — import this library by name (`@rad-orchestration/work-graph`) and resolve against the compiled `dist/` through that symlink. Neither consumer imports raw source directly.

## Running tests

```
npm test
```

This runs the vitest suites. Tests live in `tests/` and cover the store, derive helpers, graph traversal, validation, reconcile, and service facade layers.
