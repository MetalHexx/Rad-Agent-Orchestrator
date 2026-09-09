# `lib/work-graph/`

The one backend for project state and project relationships, consumed by name by both `cli/` and
`ui/`. Only groups and edges are persisted; projects, their state, their documents, and their
worktrees are derived from the filesystem on every read, so there is no stored copy to migrate and
no cache to invalidate.

It is **not** a leaf: it depends on `@rad-orchestration/repo-registry` and reads the registry on
every graph read.

## How it works

- `src/index.ts` — the facade-only barrel. **The barrel is the list of what is public**; read the
  file rather than a table here. Anything not exported there is internal, whatever its path suggests.
- `src/service.ts` — `WorkGraphService`, the only entry point a consumer touches.
- `src/store.ts` — `GraphIndex`, the only code in the repo that reads or writes `work-graph.yml`.
- `src/derive/` — everything computed at read time: `projects.ts` (project dirs, docs, halt reason),
  `project-state.ts` (the state vocabulary), `worktrees.ts` (worktree resolution),
  `status.ts` (node-status rollup), `locate.ts` (classify a cwd).
- `src/derive/portfolio.ts` — portfolio root detection, lifecycle-frontmatter parsing, and
  portfolio listing/resolution (`listPortfolios`, `resolvePortfolioAmong`). Several of its exports
  — including the `PortfolioRef` shape — are public through the barrel, unlike most of its
  `src/derive/` siblings; `cli/`'s portfolio commands and the session-context standing both consume
  it directly.
- `src/delete-project.ts` — the plan/execute pair behind `planProjectDeletion` and `deleteProject`,
  plus its own safety seam.
- `src/graph.ts` · `validate.ts` · `reconcile.ts` · `edge-semantics.ts` · `ids.ts` — traversal,
  write-time invariants, edge pruning, ranking classification, id derivation.
- `tests/` — vitest, one file per area.

What this library touches on disk, and in which direction:

| Path | Direction | Notes |
|---|---|---|
| `~/.radorc/work-graph.yml` | read + write | Groups, edges, and `rev`. Only `GraphIndex` touches it |
| `~/.radorc/projects/<id>/` | read; removed by `deleteProject` | `state.json` is read-only here — never written, migrated, or locked |
| `~/.radorc/worktrees/<name>/<repo>/` | read; removed by `deleteProject` via git | |
| `~/.radorc/side-projects/<name>/` | read; removed by `deleteProject` via `fs.rmSync` | |
| `~/.radorc/repo-registry*.yml` | read, through `@rad-orchestration/repo-registry` | On **every** `compose()` and every `locate()` |

## Conventions

- **Consumed only through `src/index.ts`.** CLI and UI call `WorkGraphService`; they never reach into
  `GraphIndex`, `WorkGraph`, the derive helpers, or the store-format types. Never import an internal
  module path from outside this library — tests inside the library may.
- **Projects are never created here.** The service derives them and can delete them; there is no
  create-project method, deliberately.
- **`state` is the answer to "what state is this project in".** `status` and `tier` are subordinate
  diagnostic detail. `DerivedProjectState.tier` is *not* the same vocabulary as `state.json`'s
  `current_tier`: a structurally complete project derives `tier: 'complete'`, which the schema never
  permits on disk (`ACTIVE_TIERS` in `derive/project-state.ts` excludes it). Do not treat a derived
  tier as a value you can write back.
- **Documents use a machinery denylist, not an extension allowlist.** `MACHINERY_FILES` in
  `derive/projects.ts` names the excluded files; everything else in a project directory lands in
  `docs.others` regardless of extension. The rationale, and why the asymmetry is deliberate, is in
  [`docs/internals/ambient-awareness.md`](../../docs/internals/ambient-awareness.md#documents-use-a-machinery-denylist-not-an-extension-allowlist)
  — read it before switching to an allowlist. Adding a machinery file means adding it to that set.
- **Project directories starting with `_` are skipped** — in `derive/projects.ts#listProjectNames`
  and again in `derive/locate.ts`'s own private copy of that walk. Nothing keeps the two in sync;
  change one and change both, or `locate()` and `listProjects()` disagree about what exists.

### The error contract, and where it does not hold

Expected domain failures are returned as values so no partial write is persisted:

- **Write methods return `Result<T>`** — `{ ok: true, data }` or `{ ok: false, error }`, with
  `error.code` either `'validation'` (a rejected invariant, an empty description, a missing group)
  or `'stale_revision'` (a compare-and-swap conflict in `GraphIndex.write`, which writes nothing).
- **Only genuine I/O faults throw** — an unparseable YAML file, or a temp-write/rename failure. No
  caller can recover from those.
- **Read methods mostly do not return `Result` — do not state that as a rule.** The prescribed idiom
  is reads-never-fail; `planProjectDeletion` is a read that returns `Result<DeletionPlan>` and
  rejects an unknown project id as a `validation` error. A consumer must check `.ok` there.

`validateNewEdge` and `validateNewGroupId` follow the same shape inverted: they return
`WorkGraphError | null`, `null` meaning acceptable. The invariants they hold — referential integrity,
no duplicate `(type, from, to)`, single-parent containment, acyclic containment, unique group id —
are enforced only at write time, and only `contains` edges are structurally constrained.

## Hazards

### A corrupt `repo-registry.yml` takes down the whole read surface

`compose()` calls `registryLocalPaths()` (`service.ts:36`) on **every** read, and
`repo-registry`'s reader throws on an unparseable file. So `getGraph`, `getNode`, `listProjects`,
`listGroups`, `resolveWorktrees`, and `locate` all throw for a *registry* fault — not just for a
corrupt `work-graph.yml`. Anything documenting the error contract as "only `work-graph.yml` throws"
is wrong.

### `deleteProject` destroys uncommitted work, and `side-project-repo` items are a recursive delete

- Worktree removal shells out to `git worktree remove --force`, which discards uncommitted changes
  and untracked files without prompting. "Removed via git" reads safer than it is.
- A `side-project-repo` item is **not** removed via git — it is
  `fs.rmSync(path, { recursive: true, force: true })` on `<root>/side-projects/<name>/`. The
  "via git, never a recursive delete" rule holds for `worktree` items only.
- `~/.radorc/` is the real home directory and there is no sandbox variable. Never run a delete to
  exercise a change; the unit suites inject a root.

### The deletion safety guards look redundant and are not

`delete-project.ts` layers name validation, containment of the resolved project directory, an
outright refusal of a symlinked project directory (the `ALIAS -> VICTIM` case is written out in the
comment), a `realpath` re-check, `resolveDeletionRefs`' local strictness over a malformed
`state.json`, and `validateRefContainment`. Each closes a distinct way a corrupt or
attacker-controlled `state.json` steers a recursive delete outside its expected tree. An agent asked
to "unify the two worktree resolvers" will read them as duplication. Read the comments before
removing any of them.

### The `group:` id prefix is a public contract that nothing enforces

Group ids are `` `group:${slugify(name)}` `` (`src/ids.ts`). `isGroupId` is exported from the
barrel, and `cli/src/commands/portfolio/list.ts` and `show.ts` call it rather than string-matching
the prefix by hand. `groupId` itself is still internal, and the remaining hand-derived sites are
unchanged: `portfolio/identity.ts` (equality against `` `group:${v}` ``), `project/lean.ts` and
`session-context/resolve.ts` (`replace(/^group:/, '')`), and `portfolio/create.ts` (interpolated
into an error message). Changing the prefix breaks all of them with no compiler help.

### Nothing here may write to stdout

Anything this package prints on stdout corrupts the `radorch` envelope, and there is no ESLint
config here at all to catch it — send diagnostics to stderr. Detail:
[`AGENTS.md`](../../AGENTS.md#stdout-is-the-envelope-channel)

## When a change here ripples

- **Changed a public export, a derived shape, or the `work-graph/v1` projection?** `cli/` and `ui/`
  both import this package **by name** and resolve against the compiled `dist/`, so a source change
  is invisible to both until `npm run build` runs here. `GraphDTO.schema` is the version
  discriminant consumers are told to reject on — changing the projection without changing it leaves
  them parsing a new shape as if it were old. Detail: [`cli/AGENTS.md`](../../cli/AGENTS.md),
  [`ui/AGENTS.md`](../../ui/AGENTS.md)

- **Added, removed, or renamed a `ProjectState`?** The dashboard keeps an exhaustive
  `Record<ProjectState, StatePresentation>` in `ui/components/badges/project-state-presentation.ts`,
  so a new state fails `next build` — which also fails the installer's `emit-ui-bundle` step and
  blocks the whole release. Every surface that renders the state word is driven from one fixture set
  by the root guard `tests/project-state-cohesion.test.ts`; run it. Detail:
  [`ui/AGENTS.md`](../../ui/AGENTS.md)

- **Changed the `Tier` vocabulary or added an edge type?** The dashboard keeps **undeclared copies**
  of both, and they fail *silently* rather than at build time: `ui/types/work-graph.ts` re-declares
  `WorkGraphTier` and `EdgeTypeKey`, `ui/lib/work-graph-dto.ts`'s `KNOWN_TIERS` coerces an
  unrecognised tier to `null`, and `ui/lib/work-graph-view.ts` falls an unrecognised edge type to
  `'other'`. A new value simply disappears from the canvas with no error anywhere. Port it into
  every one of them in the same change. Detail: [`ui/AGENTS.md`](../../ui/AGENTS.md)

- **Added a `ProjectKind`?** Unlike `Tier` and edge types, the kind vocabulary **is** guarded: the
  dashboard holds an exhaustive `Record<ProjectKind, KindPresentation>` in
  `ui/components/badges/project-kind-presentation.ts`, and `tests/project-kind-cohesion.test.ts`
  asserts that every kind in the library vocabulary has an entry. A new kind missing from the
  record fails `next build` — which also blocks the installer's `emit-ui-bundle` step and the
  whole release. Detail: [`ui/AGENTS.md`](../../ui/AGENTS.md), [`docs/internals/dashboard.md`](../../docs/internals/dashboard.md)

- **Changed `DeletionItemKind`, `DeletionOutcome`, `DeletionDisposition`, or `DeletionSkip`?** The
  dashboard branches on all of them and holds another exhaustive record —
  `KIND_LABELS: Record<DeletionItem['kind'], string>` in
  `ui/components/dag-timeline/delete-project-dialog.tsx` — while the remove route's
  `SKIPPABLE_KINDS` rejects any other kind in a skip list with a 400. A new outcome value renders as
  nothing in the dialog. Detail: [`ui/AGENTS.md`](../../ui/AGENTS.md)

- **Changed `locate()`'s result shape or its `LocateKind` vocabulary?** It is the classifier behind
  the session-start preamble: `cli/src/commands/session-context/resolve.ts` branches on `kind` to
  decide whether a standing block is rendered at all, and `cli/src/commands/execute/resolve.ts` and
  `project/locate.ts` consume it too. `resolveStanding` catches everything and returns `null`, so a
  break here does not raise — the preamble just silently stops carrying a standing. Detail:
  [`docs/internals/ambient-awareness.md`](../../docs/internals/ambient-awareness.md)

- **Changed the portfolio surface (`derive/portfolio.ts`) or the `PortfolioRef` shape?**
  `cli/src/commands/session-context/resolve.ts` calls `resolvePortfolioAmong` and copies the result
  field-by-field into its own `Standing['portfolio']` shape (`name`, `status`, `rootDoc`) rather than
  re-exporting `PortfolioRef` directly — a field added to `PortfolioRef` never reaches the preamble
  until that mapping is updated by hand, and nothing flags the gap, since TypeScript never complains
  about an unused source field. Update the field list in `Standing['portfolio']`, its construction in
  `resolve.ts`, and `render.ts`'s reads of it in the same change. Detail:
  [`docs/internals/ambient-awareness.md`](../../docs/internals/ambient-awareness.md#the-portfolio-subsection)

## Commands

```
npm run build
npm test
```

`build` runs `tsc` and emits the ESM `dist/` tree plus declarations; the `package.json` `exports`
map resolves `@rad-orchestration/work-graph` to it. **Consumers read `dist/`, never source.**

Before landing a change that consumers see, run the end-to-end build from the repo root — it runs
`build-lib-dist` for every workspace library and then bundles the CLI and the UI against it:

```
node harness-installers/standard/build-scripts/build.js
```

The cross-surface guard for the state vocabulary lives at the repo root:

```
node --test --import tsx tests/project-state-cohesion.test.ts
```

## Further reading

- [`docs/internals/ambient-awareness.md`](../../docs/internals/ambient-awareness.md) — the standing
  classifier this library's `locate` and derive helpers feed, and the machinery-denylist rationale
- [`docs/internals/dashboard.md`](../../docs/internals/dashboard.md) — how the dashboard consumes
  the projection and renders project state
- [`lib/repo-registry/AGENTS.md`](../repo-registry/AGENTS.md) — the registry this library reads on
  every graph read
- [`AGENTS.md`](../../AGENTS.md) — the repo map, why nothing here may write to stdout, and the rule
  against running destructive commands against real data
