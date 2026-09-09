# `lib/repo-registry/`

The sanctioned cross-package seam for the two-file repo registry under `~/.radorc/`. Path-injected
and dependency-light, so the CLI, the dashboard's server routes, and `lib/work-graph/` can all read
and write the same files without depending on each other.

## How it works

- `src/index.ts` — the barrel. **The barrel is the list of what is public**; read the file rather
  than a table here. Anything not exported there is internal, whatever its path suggests.
- `src/io.ts` — `readRegistry`, the raw atomic writers, and the `.gitignore` helpers.
- `src/mutations.ts` — the named semantic writes. This is the surface consumer code calls.
- `src/validate.ts` — `isSlug`, `assertUniqueName`.
- `src/resolve.ts` — `resolveRepoPath` and the unbound-repo hint string.
- `src/types.ts` — `Registry`, `RepoIdentity`, `RepoGroup`, `RootOpts`.
- `tests/` — vitest.

The files it owns, both created lazily and both returning empty maps when absent:

| File | Holds | Committed? |
|---|---|---|
| `repo-registry.yml` | Identity — the `repos` and `repo_groups` maps | Yes |
| `repo-registry.local.yml` | This machine's `paths` map only | No — gitignored by `writeLocal` |

## Conventions

- **Consumed only through `src/index.ts`.** Never import `src/io.ts`, `src/mutations.ts`,
  `src/resolve.ts`, `src/types.ts`, or `src/validate.ts` from outside this library, and never by a
  deep relative path. Tests inside the library may import internals directly.
- **Path-injected.** Every entry point takes `{ root }`. No global `~/.radorc` lookup ever happens
  inside this module — the CLI and the route supply it, which is what makes it testable against a
  temp root.
- **No side effects at import.** All I/O is deferred to a function call.
- **Never touch a `version` field or an intra-set dependency spec.** The root file's *Workspace
  versioning* invariant reserves that for a release a human engineer initiated, and it overrides any
  task handoff telling you to "bump the consumers" alongside a signature change here.

### Every semantic write is a named mutation

`writeIdentity`, `writeLocal`, and `ensureLocalGitignored` are low-level building blocks for the
mutations in `src/mutations.ts` and for test fixtures. Consumer and command code must never call
them, and must never mutate `reg.repos` / `reg.repoGroups` / `reg.localPaths` and persist inline.
Read with `readRegistry` / `resolveRepoPath`, do the domain work, then call exactly one named
mutation. `cli/tests/lib/registry-mutation-seam.test.ts` enforces this against every file under
`cli/src/commands/`.

**`ensureGitignored` is deliberately outside that guard.** The seam test's forbidden-name pattern
lists `writeIdentity|writeLocal|ensureLocalGitignored` and nothing else, and
`cli/src/commands/side-project/init.ts` binds `ensureGitignored` directly to add a `side-projects/`
entry to a repo's `.gitignore`. It is a general-purpose gitignore helper, not a registry writer —
do not "fix" the guard to include it without moving that caller first.

## Hazards

### Atomic per file, not per mutation

`atomicWrite` is tmp-write plus `renameSync`, so no half-written file and no `.tmp` residue is ever
observable. That guarantee stops at the file boundary. A mutation touching both files is **not**
atomic: `addRepo` performs `writeIdentity` and then `writeLocal`, so a crash between them leaves a
repo registered in identity with no bound local path. `removeRepo` has the mirror shape. Do not
describe this library as atomic without saying per what.

### The read path throws

`readYaml` (`src/io.ts`) throws on a file it cannot parse, so `readRegistry` and everything built on
it inherit that — including `lib/work-graph`, which reads the registry on every graph read. In
`cli/`, an uncaught throw is wrapped as `system_error` and exits 2, so a user's malformed YAML
reports as an internal failure unless the command catches it and rethrows as `UserError`.

### Failure reporting is not uniform across the mutations

Given a target that does not exist, `editRepo`, `bindRepo`, `addGroupMember`, and `editGroup`
**throw**, while `removeRepo`, `removeGroupMember`, and `deleteGroup` **return silently**. Do not
infer one mutation's behaviour from a sibling's, and do not present the set as uniform when
documenting or wrapping it.

### There is no locking

Every mutation is a read-modify-write with no lock, no revision check, and no compare-and-swap: last
writer wins and an interleaved write is lost with nothing to report it. The writers that can be live
at once: `cli/`'s `repo` and `repo-group` commands, and the dashboard's registry routes — a user can
have both running. Sibling libraries do have concurrency stories (`lib/work-graph`'s `rev`
compare-and-swap, `lib/telemetry`'s per-session lock); this one has none, so do not carry that
assumption over.

### A CLI command string is baked into this library

`src/resolve.ts` builds the unbound hint as the literal `` run `radorch repo bind <name> <path>` ``.
It is rendered into command output by `cli/src/commands/repo/list.ts`, `repo/show.ts`, and
`skill/list.ts`, and interpolated into thrown `UserError`s by `source-control/init.ts`,
`worktree/create.ts`, and `worktree/remove.ts` — from where it reaches users and the session
preamble. Renaming or reshaping that subcommand makes this library emit a stale instruction, and
nothing type-checks the pair.

### Nothing here may write to stdout

Anything this package prints on stdout corrupts the `radorch` envelope, and there is no ESLint
config here at all to catch it — send diagnostics to stderr. Detail:
[`AGENTS.md`](../../AGENTS.md#stdout-is-the-envelope-channel)

## When a change here ripples

- **Changed `readRegistry`'s shape, the on-disk file format, or its failure mode?**
  `lib/work-graph` is a consumer, not just a sibling: `WorkGraphService` calls `readRegistry` inside
  `registryLocalPaths()` on **every** `compose()` and every `locate()`, so a throw or a changed
  `localPaths` shape takes down its entire read surface — every project badge, the canvas, and the
  session-start standing. This is a library-on-library edge and is easy to miss because no CLI
  command sits between them. Detail: [`lib/work-graph/AGENTS.md`](../work-graph/AGENTS.md),
  [`docs/internals/system-architecture.md`](../../docs/internals/system-architecture.md#module-dependencies)

- **Added, renamed, or changed the behaviour of a named mutation?** These files have independent
  writers that do not import each other: `cli/src/commands/repo/` and `cli/src/commands/repo-group/`,
  and `ui/`'s `/api/repos` and `/api/repo-groups` routes. A mutation whose validation or no-op
  behaviour changes silently changes what the dashboard writes. Update both sides and re-run
  `cli/tests/lib/registry-mutation-seam.test.ts`. Detail: [`cli/AGENTS.md`](../../cli/AGENTS.md),
  [`ui/AGENTS.md`](../../ui/AGENTS.md)

- **Changed any public export or exported type?** Both consumers import this package **by name** and
  resolve against the compiled `dist/`, so a source change is invisible until `npm run build` runs
  here. In `ui/`, a route that value-imports this package also needs its `outputFileTracingIncludes`
  entry in `ui/next.config.mjs` — without it the route works in dev and returns 500 in the shipped
  standalone build. Root `AGENTS.md` names this module explicitly in its pre-land gates: every
  installer build must exit 0. Detail: [`ui/AGENTS.md`](../../ui/AGENTS.md),
  [`harness-installers/AGENTS.md`](../../harness-installers/AGENTS.md)

## Commands

```
npm run build
npm test
```

`build` runs `tsc` and emits the ESM `dist/` tree plus declarations; the `package.json` `exports` map
resolves `@rad-orchestration/repo-registry` to it. **Consumers read `dist/`, never source** — the CLI
bundle and the UI both break confusingly if you skip the build.

Pre-land, from the repo root:

```
node harness-installers/standard/build-scripts/build.js
node harness-installers/claude-plugin/build-scripts/build.js
node harness-installers/copilot-cli-plugin/build-scripts/build.js
node harness-installers/copilot-vscode-plugin/build-scripts/build.js
```

## Further reading

- [`docs/internals/system-architecture.md`](../../docs/internals/system-architecture.md#module-dependencies)
  — where this package sits in the dependency graph, and why it is the bottom of it
- [`docs/internals/dashboard.md`](../../docs/internals/dashboard.md) — the registry routes that
  write these files alongside the CLI
- [`cli/AGENTS.md`](../../cli/AGENTS.md) — the mutation-seam rule from the caller's side, and how a
  throw from here is classified in the envelope
- [`AGENTS.md`](../../AGENTS.md) — the repo map, the sanctioned cross-package seam invariant, and
  why nothing here may write to stdout
