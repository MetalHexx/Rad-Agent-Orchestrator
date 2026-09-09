# `harness-installers/shared/build-helpers/`

The mechanical steps every installer build reaches for: bundling, packing, token substitution, and
one parity check. Packaged as `@rad-orchestration/build-helpers` (private) so it can hold its own
`esbuild` and `tar` dependencies — callers still import the files by relative path, never by package
name.

## How it works

One helper per file, each exporting a single named function taking one `opts` object:

| File | Export | Does |
|---|---|---|
| `docs-corpus.js` | `stageDocsCorpus` | Enumerates and stages the shipped documentation corpus (`README.md`, `docs/`, `assets/`), holding the one exclusion rule `standard/`, `claude-plugin/`, `copilot-cli-plugin/`, and `copilot-vscode-plugin/` all share |
| `expand-tokens.js` | `expandTokens` | Walks a tree; substitutes `tokenMap` and applies agent-namespacing in text files, copies everything else verbatim |
| `emit-cli-bundle.js` | `emitCliBundle` | esbuild bundles a CLI entry point to a single ESM file, chmod `0o755` |
| `emit-ui-bundle.js` | `emitUiBundle` | Runs the Next.js standalone build, packs it into one gzipped tarball |
| `emit-hook-bundle.js` | `emitHookBundle` | Bundles a plugin's `bootstrap.mjs`, copies its verbatim hook files, stages the shared shims |
| `manifest-parity.js` | `checkInstallSourceParity` | Compares a plugin's built payload against its built manifest catalog, both directions |

`stageDocsCorpus` is the first helper every builder calls — `standard/` and all three plugin
variants stage the same corpus, so the enumeration and the exclusion rule live here exactly once
rather than as separate copies that would have to agree.

The convention is that `__tests__/` holds the per-helper behaviour suites and `tests/` holds
structural guards that read every builder's source text. Both are live, and CI runs them as separate
steps. The convention has a known deviation: `tests/emit-hook-bundle.test.mjs` calls `emitHookBundle`
directly, so it is a behaviour suite sitting on the structural-guard side. Place a new suite by the
convention, not by that precedent.

`emitHookBundle` and `checkInstallSourceParity` are plugin-shaped and are not used by the standard
installer — see the installer-blindness note in [`../AGENTS.md`](../AGENTS.md).

## Conventions

- **One `opts` object per export.** No positional parameters, no global state, no module-level side
  effects.
- **I/O stays inside the paths it was handed.** A helper never reads or writes outside them. Most
  take a `source`/`target` pair; `checkInstallSourceParity` takes an `outputDir` and reads only under
  it. The parameter names vary, the containment rule does not.
- **esbuild and tar failures propagate as throws.** Callers wrap them in their `step()` helper, which
  is what produces the `[build:<variant>] step "<name>" failed: …` message. Do not catch and
  degrade here.
- **`TEXT_EXTS` in `expand-tokens.js` mirrors the list in `harness-adapters/engine/index.js`.** The
  two decide independently which files get read as text; they must agree, and nothing checks that
  they do.

## Hazards

### `absWorkingDir` in `emitCliBundle` is load-bearing for byte-determinism

esbuild labels bundled modules with paths relative to its working directory. Those labels are
cosmetic but they land in the output bytes, so without the pin the same source produces a different
bundle depending on whether the build ran from the repo root or from an `npm run -w <workspace>`
cwd. Do not remove the pin or "simplify" it to `process.cwd()`. Nothing downstream is watching for
it: the manifests are hashless path catalogs, the drift gate compares paths, and `validate.js`
checks a size budget — no gate hashes the bundle, so this pin is what holds its reproducibility.

### `emitUiBundle` deletes `<source>/.next/` when it finishes

Packing is destructive to the build output it just consumed. A caller that stubs the `next build`
runner and then runs against a tree a real build already cleaned finds nothing to pack and writes a
near-empty tarball over a good one. The standard builder's `skipUiBundle` flag exists precisely to
avoid that path — see [`../../standard/build-scripts/AGENTS.md`](../../standard/build-scripts/AGENTS.md).

### The tarball shape is the point

The UI is shipped as one opaque `.tgz` rather than a loose tree because both `npm pack` and the
satellite repo's `.gitignore` strip `node_modules/` and `.next/`, which would erase the UI runtime
in transit. `portable: true` strips OS-specific metadata so the tarball hashes identically across
Windows, macOS, and Linux builds. Neither of those is a detail you can drop.

### `emitHookBundle` stages **both** shims, not just the preamble

The verbatim-copy list it reads from the plugin's own `hooks/` is
`drift-check.mjs`, `hooks.json`, `launcher.cjs`, `AGENTS.md`. Separately, it copies
`session-preamble.mjs` **and** `telemetry-capture.mjs` from `sharedHooksDir`, falling back to the
plugin `source` when that option is absent. Adding a per-plugin hook file means extending the
verbatim list here; adding a shared shim means extending the shim list.

## When a change here ripples

- **Changed a helper's parameter shape or return value?** Nothing resolves these imports until that
  build or suite runs, so a missed caller surfaces as a CI failure in a variant you never opened —
  and **the caller set is not the same for every helper**, so grep for the export you changed rather
  than assuming every variant's `build-scripts/build.js` imports it. The plugin-shaped pair above is where
  that bites: `emitHookBundle` has no standard-builder caller, and `checkInstallSourceParity` is
  reached from no builder at all, only each plugin variant's
  `tests/manifest-payload-parity.test.mjs`. Detail: [`../AGENTS.md`](../AGENTS.md)

- **Changed `TEXT_EXTS`, or anything else that decides which files are read as text?** The adapter
  engine keeps its own copy of the same list and applies it one pass earlier. If the two disagree, a
  file is transformed on one side of the pipeline and copied byte-for-byte on the other, with no
  error. Change both. Detail: [`../../../harness-adapters/AGENTS.md`](../../../harness-adapters/AGENTS.md)

- **Changed what `emitCliBundle` writes, or where?** Its target lands inside the per-harness tree
  that `emit-manifest.js` walks, so a changed filename or nesting level means a regenerated standard
  manifest in the same change — run the build and commit the diff. The manifests carry no per-file
  hash, so changing the bundle's *contents* produces no diff and trips nothing. `emitUiBundle`'s
  tarball is written outside that tree and `ui/` is excluded from the manifest besides, so it has no
  manifest obligation at all; neither output appears in the plugin variants' manifests, which
  catalog what `runtime-config/` ships plus the generated documentation corpus. Detail:
  [`../../standard/AGENTS.md`](../../standard/AGENTS.md)

## Commands

Both suites, from the repo root:

```
node --test harness-installers/shared/build-helpers/__tests__/*.test.mjs
node --test harness-installers/shared/build-helpers/tests/*.test.mjs
```

Then the builds that consume them — see [`../../AGENTS.md`](../../AGENTS.md).

## Further reading

- [`../AGENTS.md`](../AGENTS.md) — the installer-blindness rule and where it currently does not hold
- [`../../standard/build-scripts/AGENTS.md`](../../standard/build-scripts/AGENTS.md) — the caller
  that drives these helpers over every harness in one pass
- [`../../AGENTS.md`](../../AGENTS.md) — the variants, and the manifest discipline
