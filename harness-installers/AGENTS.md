# `harness-installers/`

Every shippable variant of the system, plus the build helpers and hook shims they share. Each
variant is its own npm workspace on its own release cycle; this folder holds no code of its own, and
the discipline it enforces is that a variant never reaches into a sibling.

> **Where this sits in the pipeline from canonical source to a user's machine:**
> [`docs/internals/system-architecture.md`](../docs/internals/system-architecture.md#from-canonical-source-to-your-machine).
> Read it before adding a variant or changing what a build emits. Not needed to edit an existing
> build step.

## How it works

The variants, by release channel:

| Variant | Channel | Notes |
|---|---|---|
| [`standard/`](./standard/AGENTS.md) | npm — published as `rad-orc`, run via `npx rad-orc` | Builds **every harness in one pass** into `output/<harness>/` and generates the manifests |
| [`claude-plugin/`](./claude-plugin/AGENTS.md) | Claude marketplace plugin | One harness per build; stages payload under `output/_install-source/` |
| [`copilot-cli-plugin/`](./copilot-cli-plugin/AGENTS.md) | Copilot CLI marketplace plugin | Same shape as `claude-plugin/`; its own `AGENTS.md` carries the deltas |
| [`copilot-vscode-plugin/`](./copilot-vscode-plugin/AGENTS.md) | Copilot in VS Code marketplace plugin | Same shape again; its own `AGENTS.md` carries the deltas |

And the shared subtree, which is not a variant:

- [`shared/build-helpers/`](./shared/build-helpers/AGENTS.md) — build-time helpers imported by every
  build script via relative path.
- [`shared/hooks/`](./shared/hooks/AGENTS.md) — the **runtime** hook shims. These execute on the end
  user's machine; they are not build tooling.

What this layer consumes and does not own: `harness-adapters/output/<harness>/` (compiled agents and
skills), [`runtime-config/`](../runtime-config/AGENTS.md) (shipped verbatim), and `cli/` and `ui/` at
the repo root (bundled by `emitCliBundle` and `emitUiBundle`).

### The plugin variants are near-copies of one another

`claude-plugin/`, `copilot-cli-plugin/`, and `copilot-vscode-plugin/` are the same tree three times —
same `build-scripts/build.js` step sequence, same bootstrap-on-first-prompt hook lifecycle, and the
same `lib/install/` module set with one exception — `bake-paths.js` exists only in
`copilot-vscode-plugin/`. Nothing is shared: cross-variant imports are forbidden, so
each carries its own copy of every file, and `lib/install/ui-stop.js` and `lib/install/catalog.js`
are currently byte-identical in all three.

There is no per-package bootstrap step in any of them —
`shared/build-helpers/tests/no-per-package-bootstrap.test.mjs` asserts it across every builder.

These install-side rules hold in every plugin variant, and each is the reason a user's data survives:

- **An existing user-config destination is never overwritten** — an edited
  `~/.radorc/orchestration.yml` survives an upgrade. The standard channel reaches the same guarantee
  by a different mechanism; see [`runtime-config/AGENTS.md`](../runtime-config/AGENTS.md) for both.
- `removeManifestFiles` **throws** — before touching disk — on any manifest entry resolving under a
  catalog's `custom/` slot.
- **The documentation corpus is replaced, never merged** — `~/.radorc/docs/` is removed in full
  immediately before the manifest copy, so the pages left on disk are exactly the ones the delivered
  release carries. It is installer-owned end to end; no user content lives under it. The removal sits
  after the noop and downgrade-noop fast paths have already returned, so an unchanged re-run does not
  touch it.
- `lib/install/ui-stop.js` runs before any file work, **SIGTERMs a running dashboard**, and aborts
  the whole install with `UiLockError` if the process will not die.

Each variant's `AGENTS.md` carries only what differs from this shape.

## Conventions

- **Each variant is a standalone workspace package.** Its own `package.json`, its own test suite, its
  own version cycle. Cross-variant imports are forbidden; sharing happens only through `shared/`.
- **Never import `shared/build-helpers/` from runtime code.** Hook shims and install logic must not
  reach for build tooling — the helpers are not shipped to a user's machine. The reverse direction is
  fine and deliberate: build scripts stage `shared/hooks/` shims into their output.
- **`output/` is generated and gitignored in every variant.** Never hand-edit it, never commit a fix
  into it. Fix the source and rebuild.
- **`manifests/` is not `output/`.** See the hazard below.
- **A fix to one plugin variant is a fix owed to the other two**, and the divergence is already real:
  `install-files.js`'s destination-containment guard is a `path.relative` test in `claude-plugin/`
  and a `startsWith(root + path.sep)` comparison in both Copilot variants, and `cmpSemver` is a
  separate implementation in each of the three. Read the variant you are in; never assume its
  sibling's behaviour.

## Hazards

### `manifests/` is committed output, and it lands in the PR diff

Every variant carries a tracked `manifests/` folder. It is the one generated artifact in this tree
that git sees, and it is the one an agent is most likely to "clean up":

- **`standard/manifests/<harness>/v<version>.json` is generated** by the build's `emit-manifest`
  step and gated by `npm run check:manifest-drift` in CI. A rebuild that changes the payload changes
  these files, and the diff must be committed.
- **The plugin variants' `manifests/v<version>.json` are hand-authored for the `runtime-config/`
  portion only.** The build copies the committed file into `output/manifests/` and its
  `merge-docs-manifest` step folds the generated documentation-corpus entries into that copy —
  nothing ever writes back into the source tree, so the committed file carries no docs entry. The
  built catalog, not the committed one, is what a user's machine installs from, and it is what each
  variant's `tests/manifest-payload-parity.test.mjs` compares against the built payload. That test is
  the only thing that catches a payload/catalog mismatch.

Reverting a manifest diff or adding `manifests/` to `.gitignore` breaks the drift gate and breaks
uninstall on real machines — uninstall removes only what the recorded manifest lists.

**The standard installer's prior-version manifests are retained on purpose.** An upgrade loads the
*installed* version's manifest to remove the old files before installing the new ones, and every
prior `standard/manifests/<harness>/v*.json` is copied forward into the payload for exactly that
reason. Deleting one strands every user still on that version. Add; do not prune.

### The plugin variants keep exactly one manifest, and an upgrade cannot read the old one

`<variant>/manifests/` holds a single `v<version>.json`; the release flow `git mv`s it forward to the
new version rather than adding alongside, and the build copies whatever it finds into `output/`.
`run-install.js` opens the **installed** version's catalog to remove the old payload before writing
the new one, inside a swallowed `catch` — and the new payload does not contain it, so that pass is
skipped. A file dropped from the payload between two releases stays on the user's machine, silently.
Adding a file is safe; removing or re-homing one is the case to think about. `~/.radorc/docs/` is the
one exception, and only because the install removes that whole tree first for exactly this reason.

### `hooks/AGENTS.md` is published to end users

`shared/build-helpers/emit-hook-bundle.js` copies each plugin's `hooks/AGENTS.md` verbatim into
`output/hooks/`, and every variant's synthesized `package.json` lists `hooks/` in `files` — so it
lands in the marketplace tarball and on a stranger's disk. The public-repo rule in
[root `AGENTS.md`](../AGENTS.md) and `harness-files/`'s *the audience is a stranger* rule both reach
every plugin's `hooks/AGENTS.md`.

### `.expand-staging/` can survive a failed build, and the release commits everything

Every plugin build writes `<variant>/.expand-staging/` during `expand-tokens` and removes it on both
sides of the step — but not on a throw. Only `copilot-cli-plugin/.gitignore` lists it, and the
release flow stages with `git add -A`. Check `git status` after a build that threw.

### A registered adapter ships nowhere until a builder names it

Every build carries its own hardcoded harness list. `standard/build-scripts/build.js` names the set
twice — the `HARNESSES` constant and again in the `validate` step's arguments — and each plugin build
hardcodes a single `--harness=` literal. An adapter in none of them produces
`harness-adapters/output/` that nobody stages, and no build fails.

## When a change here ripples

- **Changed a `shared/build-helpers/` signature or its behaviour?** These are imported by relative
  path and nothing resolves the imports until that build or suite runs, so a missed caller fails in
  CI at the variant that was not touched. The caller set differs per helper: the standard builder
  does not import `emitHookBundle`, and `checkInstallSourceParity` is reached from no build script at
  all, only each plugin variant's `tests/manifest-payload-parity.test.mjs`. Grep for the export you
  changed before changing a parameter shape. Detail:
  [`shared/build-helpers/AGENTS.md`](./shared/build-helpers/AGENTS.md)

- **Added, renamed, deleted, or re-homed a file that ships to a user?** The manifests are path
  catalogs and **uninstall removes only what a manifest recorded**, so a stale one leaves orphaned
  files behind. Which manifest you owe depends on the file. The standard installer's regenerate —
  run the build and commit the diff — but they exclude `orchestration.yml`, `templates/`, and `ui/`,
  which hydration installs instead. The plugin variants' committed catalogs must be edited by hand
  and cover **only** what `runtime-config/` ships — the documentation corpus is generated into the
  built catalog instead, and an agent, skill, CLI, or UI file needs no plugin-manifest edit at all.
  Editing a file's *content* does not touch any manifest and
  never trips the gate. Detail: [`standard/AGENTS.md`](./standard/AGENTS.md),
  [`runtime-config/AGENTS.md`](../runtime-config/AGENTS.md)

- **Added a harness adapter?** Registering it with the adapter engine does not ship it. It has to be
  added to the standard builder's `HARNESSES` list and to the install-side tables that key off a
  harness name, and it needs its own `standard/manifests/<harness>/` folder. Detail:
  [`standard/AGENTS.md`](./standard/AGENTS.md),
  [`harness-adapters/AGENTS.md`](../harness-adapters/AGENTS.md)

- **Fixed something inside one plugin variant's `lib/install/`, `hooks/`, or `build-scripts/`?** The
  other two carry their own copy of the same file and nothing links them — no shared module, no
  cross-variant test, separate CI steps. A correction that lands in one tree is invisible to the
  others, which is how the same bug has survived three rewrites here. Open the sibling files, decide
  per variant whether the fix applies, and say which ones you cleared. Detail:
  [`claude-plugin/AGENTS.md`](./claude-plugin/AGENTS.md),
  [`copilot-cli-plugin/AGENTS.md`](./copilot-cli-plugin/AGENTS.md),
  [`copilot-vscode-plugin/AGENTS.md`](./copilot-vscode-plugin/AGENTS.md)

## Commands

Build a variant:

```
node harness-installers/standard/build-scripts/build.js
node harness-installers/claude-plugin/build-scripts/build.js
node harness-installers/copilot-cli-plugin/build-scripts/build.js
node harness-installers/copilot-vscode-plugin/build-scripts/build.js
```

Per-variant test suites, and the standard installer's manifest gate:

```
npm test -w harness-installers/standard
npm test -w harness-installers/claude-plugin
npm test -w harness-installers/copilot-cli-plugin
npm test -w harness-installers/copilot-vscode-plugin
npm run check:manifest-drift -w harness-installers/standard
```

Shared-subtree guards, which no workspace `npm test` picks up:

```
node --test harness-installers/shared/build-helpers/tests/*.test.mjs
node --test harness-installers/shared/build-helpers/__tests__/*.test.mjs
node --test harness-installers/shared/hooks/tests/*.test.mjs
```

To install a plugin build on your own machine, run the **`/rad-dogfood-plugin`** skill — it takes the
variant as a parameter and stages `output/` into that variant's gitignored `dogfood-marketplace/`,
because no harness's `/plugin install` can consume `output/` directly.

## Further reading

- [`docs/internals/system-architecture.md`](../docs/internals/system-architecture.md#from-canonical-source-to-your-machine)
  — how canonical source reaches a user's machine, and where these builds sit in it
- [`standard/AGENTS.md`](./standard/AGENTS.md) — the npm channel, and the install-time contract
- [`shared/AGENTS.md`](./shared/AGENTS.md) — the shared subtree, and the build-time versus runtime
  split that governs what may live there
- [`shared/build-helpers/AGENTS.md`](./shared/build-helpers/AGENTS.md) — helper contracts
- [`shared/hooks/AGENTS.md`](./shared/hooks/AGENTS.md) — the shims that run on a user's machine
- [`harness-adapters/AGENTS.md`](../harness-adapters/AGENTS.md) — what produces this layer's input
- [`AGENTS.md`](../AGENTS.md) — the repo map, and the Distribution surface this folder sits on
