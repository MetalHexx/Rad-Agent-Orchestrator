# `harness-installers/standard/build-scripts/`

The standard channel's build orchestrator and its gates. `build.js` fans canonical source through
the adapter engine into a staged tree per harness, then emits the generated manifests that the
installer and the CI drift gate both depend on.

## How it works

The files:

- `build.js` — the whole pipeline. Exports `runBuild(opts)`; self-runs only when invoked as
  `process.argv[1]`, so importing it is safe.
- `emit-manifest.js` — walks one harness's staged tree and writes its path catalog. Beyond it and
  `validate.js`, the step implementations `build.js` calls come from
  [`shared/build-helpers/`](../../shared/build-helpers/AGENTS.md).
- `validate.js` — the final gate. Throws to abort the build.
- `check-manifest-drift.mjs` — the CI gate. Imports `runBuild`, rebuilds with the UI skipped, and
  fails when `git status` reports anything under `manifests/`.

The pipeline is fail-fast; there is no partial-success path.

The publish `package.json` is the source-side `standard/package.json` itself. `npm pack` runs from
`standard/`, one level **above** `output/` — which is why `validate.js` sizes the tarball from there,
and why no output-side `package.json` is synthesized.

## Conventions

- **Fixed step order; no conditional reordering.** `skipAdapterEngine`, `skipBootstrap`, and
  `skipUiBundle` bypass their step outright rather than running it empty; **`skipUiRunner` does
  not** — read the hazard below before reaching for either UI flag. None of them may be used to
  reorder the steps that do run.
- **`build-lib-dist` must precede both `emit-cli-bundle` and `emit-ui-bundle`**, and must build
  `repo-registry` → `work-graph` → `telemetry` → `terminal-launch` in that order.
  `shared/build-helpers/tests/build-lib-dist-order.test.mjs` pins the precedence in every builder,
  but its expected list stops at `telemetry` — `terminal-launch`'s position is unguarded, so keep it
  last by hand.
- **There is no per-package bootstrap step.** `shared/build-helpers/tests/no-per-package-bootstrap.test.mjs`
  asserts no builder contains a `bootstrap-deps` step or a `BOOTSTRAP_TARGETS` constant — the repo
  installs once at the root.
- **Every shared-helper call passes its installer-specific values as parameters.** No shared state,
  no imported config.
- **`emit-manifest.js` stays parameterized.** Harness and version arrive as arguments so it can run
  unmodified for any harness.
- **`custom/` ships as an empty directory.** The catalog copy steps — `copy-action-events` and
  `copy-communication-styles` — filter out everything inside it so an install never clobbers a user's
  overlay. A change to either step must preserve the filter.

## Hazards

### `tokenMapFor()` returns `{}` on purpose

It looks like dead code and it is not. `${PLUGIN_ROOT}` and `${SKILLS_ROOT}` are per-user paths
resolved at **install** time. Baking them here — the old behaviour — embedded the build machine's
home directory into every shipped skill file, which was wrong for every other user *and* made the
generated manifests non-reproducible across machines and platforms. Filling the map back in
reintroduces both failures.

### `skipUiBundle` and `skipUiRunner` are not interchangeable

`skipUiRunner` still runs `emitUiBundle`, stubbing only the `next build` — it writes a real, minimal
`ui.tgz`, which is what unit tests need. `skipUiBundle` skips the step entirely and leaves any
existing tarball untouched, which is what `check-manifest-drift.mjs` needs. Conflating them once
shipped a published package whose UI bundle had no `server.js`: `emitUiBundle` always deletes
`ui/.next` after packing, so a stubbed rerun after a real build found nothing to pack and overwrote
the good tarball with a near-empty one.

### This build writes into the source tree

`emit-manifest` writes `manifests/<harness>/v<version>.json` — tracked, committed files, diffed by
`npm run check:manifest-drift` in CI. `output/` is the gitignored part; `manifests/` is not.

### `validate` is the last step, so its failures are expensive

It gates on required per-harness artifacts, on every canonical agent existing under the filename
suffix that harness's adapter produces, on the per-harness manifest being present, and on the packed
size budget. A filename-convention change surfaces here after the entire build has run, not at the
step that caused it.

## When a change here ripples

- **Changed a step, or what any step writes into `output/`?** The manifest is regenerated from that
  tree, so the committed catalog changes with it and CI fails until the diff is committed. Run
  `npm run check:manifest-drift -w harness-installers/standard` before landing. Detail:
  [`../AGENTS.md`](../AGENTS.md)

- **Added a step, changed the ordering, or removed one?** The structural guards in
  `shared/build-helpers/tests/` read every builder's source text, so a reordering here can fail on
  behalf of a plugin builder you never opened — and the reverse. Detail:
  [`../../shared/build-helpers/AGENTS.md`](../../shared/build-helpers/AGENTS.md),
  [`../../AGENTS.md`](../../AGENTS.md)

- **Adding a harness?** `HARNESSES` and the `validate` step's `harnesses` argument both name the set
  here, and `validate.js` keeps its own agent-suffix map. The install side has several more tables
  that must move with it. Detail: [`../lib/install/AGENTS.md`](../lib/install/AGENTS.md),
  [`harness-adapters/AGENTS.md`](../../../harness-adapters/AGENTS.md)

- **Added or changed a step that stages a `runtime-config/` catalog?** Each catalog gets its own
  step, and the steps differ only in source and destination folder — `copy-action-events` and
  `copy-communication-styles` carry the same inline `custom/` filter, `copy-runtime-config` carries
  none — so one copied from a neighbour with an unedited source path stages the wrong tree. Whether
  a catalog lands under `~/.radorc/` rather than the per-harness root is not decided in the step:
  add its prefix to `emit-manifest.js`'s `USER_DATA_PREFIXES`. Detail:
  [`runtime-config/AGENTS.md`](../../../runtime-config/AGENTS.md). `copy-docs-corpus` also gained a
  `USER_DATA_PREFIXES` member, but it does not stage a `runtime-config/` catalog — its source is the
  repo-root documentation corpus (`README.md`, `docs/`, `assets/`), staged through the shared
  `stageDocsCorpus` helper rather than an inline `fs.cpSync`.

## Commands

```
node harness-installers/standard/build-scripts/build.js
npm run check:manifest-drift -w harness-installers/standard
node --test harness-installers/standard/tests/build/*.test.mjs
```

## Further reading

- [`../AGENTS.md`](../AGENTS.md) — the package this build produces, and the install-time contract
- [`../../shared/build-helpers/AGENTS.md`](../../shared/build-helpers/AGENTS.md) — the helpers these
  steps call
- [`harness-adapters/AGENTS.md`](../../../harness-adapters/AGENTS.md) — what produces this build's
  input
