# `tests/`

The repo-root guard suite. Every test here asserts something **no single module can own** — either
because it spans modules that are forbidden to import each other, or because it is a fact about the
repository's own wiring rather than about any module's behavior.

If a guard can live inside a module, it belongs there. This folder is for the ones that cannot.

## How it works

One file per concern, run from the repo root:

- `project-state-cohesion.test.ts` — drives every surface that answers *"what state is this project
  in?"* from one shared fixture set and asserts they agree on the same canonical state and the same
  word.
- `project-kind-cohesion.test.ts` — its sibling for *"what kind of project directory is this?"*:
  drives the library's derivation, the dashboard's own reader, and the three rendering surfaces
  (sidebar list, project header, work-graph canvas node) from one shared fixture set and asserts
  they agree on the same canonical kind and select the right badge for it.
- `workspace-linkage.test.mjs` — the root `package.json` declares a `workspaces` array and it covers
  the libraries and their consumers.
- `by-name-resolution.test.mjs` — the workspace packages resolve **by name** from the repo root.
- `ci-workflows.test.mjs` — the CI workflows still invoke the suites this repo depends on, asserted
  against the **command form**, not just the presence of a step.
- `check-delivered-payload.mjs` — a script, not a test: it fails the build when a dev-only skill has
  leaked into `harness-files/skills/`. `check-delivered-payload.test.mjs` covers the script's own
  matching logic.

## Conventions

### The cross-module reach-in lives here and nowhere else

The root `AGENTS.md` forbids cross-module reach-ins and carves out exactly two exceptions, one per
file: `project-state-cohesion.test.ts` reaches into both `cli/src/` and `ui/` internals — `ui/` may
never import `cli/src/` and `cli/` may not import `ui/`, so this is the only place all the
project-state surfaces can be exercised together. `project-kind-cohesion.test.ts` reaches only into
`ui/` internals — the project-kind vocabulary has no CLI surface, so it needs no `cli/` reach at
all.

Two things make the `ui/` reach work, and both are easy to break from outside this folder:

- **The root `tsconfig.json` maps `@/*` to `./ui/*`.** That alias exists so these guards can import
  UI modules the same way UI code does. It is not decoration — remove it and both guards stop
  compiling.
- **`cli/` is reached by relative path** (`../cli/src/commands/...`), because it has no alias —
  only `project-state-cohesion.test.ts` uses this one.

**Keep every reach-in inside its own guard file.** If a surface cannot be imported cleanly, lift its
pure step into its own module rather than widening the reach from here — each exception is a single
file, not a licence for the folder.

### Assert the command form, not just that a step exists

`ci-workflows.test.mjs` pins the literal invocation because a weaker check passes while the suite
silently stops running. The worked example is this folder's own command: a `tests/*.test.mjs` glob
alone matches none of the TypeScript guards, so the suite would report green having run half of
itself. The guard asserts `--import tsx` and both globs together for that reason.

## Hazards

### The delivered-payload denylist is a hand-maintained list, not a derived one

`check-delivered-payload.mjs` carries a literal `DENYLIST` of folder names that must never appear in
`harness-files/skills/`. It is **not** derived from the dev-skill carve-out in the root
`AGENTS.md`, and the two sets do not match: the denylist names some dev skills and not others, and
it names entries that no longer exist. Adding a dev skill therefore does **not** get it covered here.
If a new dev skill must never ship, add it to that list explicitly.

### A guard here fails on someone else's pull request

These tests read `package.json`, `tsconfig.json`, the CI workflows, and modules in `cli/` and `ui/`.
A change in any of those can break a guard in this folder, and the author will not have run this
suite. Run it before landing anything that touches workspace wiring, the project-state or
project-kind vocabulary, or a CI command.

## When a change here ripples

- **Added a project state, or changed how one is labelled?** `project-state-cohesion.test.ts` drives
  every surface from one fixture set and requires them to agree, so a new state that reaches the
  library and not the badge fails **here** rather than shipping a project that renders as blank.
  The vocabulary is owned by `@rad-orchestration/work-graph`; update the surfaces it lists in the
  same change. Detail: [`lib/work-graph/AGENTS.md`](../lib/work-graph/AGENTS.md)

- **Added a project kind, or changed how one is presented?** `project-kind-cohesion.test.ts` drives
  the library's derivation, the dashboard's own reader, and every rendering surface from one fixture
  set and requires them to agree, so a new kind that reaches the library and not a surface fails
  **here** rather than shipping a project that renders as blank. The vocabulary (`PROJECT_KINDS`) is
  owned by `@rad-orchestration/work-graph`; update `KIND_PRESENTATION` and the surfaces it lists in
  the same change. Detail: [`lib/work-graph/AGENTS.md`](../lib/work-graph/AGENTS.md)

- **Added a workspace, or changed a package name?** `workspace-linkage.test.mjs` and
  `by-name-resolution.test.mjs` assert the root `package.json` covers it and that it resolves by
  name. By-name resolution is the sanctioned seam — a package that only resolves by relative path
  builds locally and breaks the installer bundle. Detail: [`AGENTS.md`](../AGENTS.md)

- **Changed a CI command, or moved a test suite?** `ci-workflows.test.mjs` pins the invocation form,
  so renaming a suite or dropping a glob fails here instead of silently running nothing. Update the
  workflow and the assertion together. Detail:
  [`CONTRIBUTING.md`](../CONTRIBUTING.md#before-you-open-a-pr)

- **Added a dev-only skill?** It does not ship from `.claude/skills/` or `.agents/skills/`, and this
  guard cannot see it there: `check-delivered-payload.mjs` scans `harness-files/skills/` only, so it
  fires just once a matching name has been copied into canonical source. Add the name to `DENYLIST`
  in the same change so an accidental copy-in fails here instead of shipping — the list is
  hand-maintained and covers only selected names, per the hazard above. Detail:
  [`harness-files/AGENTS.md`](../harness-files/AGENTS.md)

## Commands

Run from the repo root. Both globs are required — the `.mjs` glob alone skips the TypeScript guards:

```
node --test --import tsx "tests/*.test.mjs" "tests/*.test.ts"
```

The payload check is a script and runs separately:

```
node tests/check-delivered-payload.mjs
```

The workspace libraries must be built first, or the imports fail confusingly:

```
npm run build -w @rad-orchestration/repo-registry -w @rad-orchestration/work-graph -w @rad-orchestration/telemetry -w @rad-orchestration/terminal-launch
```

## Further reading

- [`AGENTS.md`](../AGENTS.md) — the repo map, the reach-in ban and this folder's two exceptions to
  it, and the workspace-versioning rules
- [`cli/tests/behavioral/AGENTS.md`](../cli/tests/behavioral/AGENTS.md) — the pipeline's own
  behavioral tier, for guards that belong to `cli/` rather than to the repo
- [`harness-files/tests/AGENTS.md`](../harness-files/tests/AGENTS.md) — corpus-wide guards over
  shipped agent and skill content
