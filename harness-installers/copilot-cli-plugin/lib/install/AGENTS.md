# `harness-installers/copilot-cli-plugin/lib/install/`

Everything in the Copilot CLI plugin channel that touches a user's disk. `hooks/bootstrap.mjs` is the
only importer; esbuild inlines this whole folder into the bundled hook, so nothing here ships as a
file a user could see or a test could resolve at runtime.

> **The install-side rules that hold across all three plugin variants** — `user-config` seed-once,
> the `custom/` refusal, the pre-flight UI stop, and the single-manifest upgrade gap — are in
> [`../../../AGENTS.md`](../../../AGENTS.md) — the near-copies section and the manifest hazards.
> Read that first; this file carries what is specific to this variant.

## How it works

`run-install.js` is the entry point.

Where files land: every manifest entry in this channel destinates under `${RAD_HOME}/…`. The plugin's
own `agents/` and `skills/` are not installed anywhere — the harness reads them in place from the
plugin root, which is why the manifests catalog only what
[`runtime-config/`](../../../../runtime-config/AGENTS.md) and the shipped documentation corpus
contribute.

What is different here, against the sibling variants:

- **Install key `copilot-cli-plugin`**, written by `buildCopilotCliPluginEntry`.
- **Coexistence probe names both standard-installer Copilot keys** — `copilot-cli` and
  `copilot-vscode` — and lists every partner present in one warning.
- **`migrateInstallJson` exists here**, lifting legacy flat or `state_schema_version`-tagged registry
  shapes into the `harnesses`-keyed shape. The VS Code variant has no equivalent because its install
  key postdates those shapes.
- **The delivering version comes from the payload's root `plugin.json`**, falling back to
  `package.json`. This is the one variant whose build actually writes `plugin.json` at the payload
  root, so the first read is the one that fires.
- **There is no `telemetry` key** in `user-data-paths.js` and no telemetry skip in `remove-files.js`.
  `claude-plugin/` and the standard installer both carry that protection; `copilot-vscode-plugin/`
  does not have it either.

## Conventions

- **Everything is path-injected.** `radHome` arrives as a parameter and flows through
  `userDataPaths({ radHome })`. Nothing in this folder reads the environment — env reads happen in
  `hooks/bootstrap.mjs` only, which is what lets the suites run against a temp home.
- **`install.json` is the answer to "is this installed?"** Never infer it from files on disk.
  `loadRegistry` degrades a missing, unreadable, or shape-drifted file to `{ harnesses: {} }` rather
  than throwing.
- **State files are written tmp-then-rename.** `writeInstallJson` and the `hooks.json` rewrite in
  `bootstrap.mjs` both do. Manifest-driven copying is not atomic — it goes entry by entry.
- **Log writes never propagate.** `appendInstallLog` wraps its whole body and swallows.
- **`userDataPaths` is where this folder constructs a `~/.radorc/` sub-path.** Add new ones there,
  never inline in a caller. Outside this folder, `hooks/drift-check.mjs` builds its own. There is no
  marker-file path and no manifest-snapshot path — the manifest is always read from the payload's own
  `manifests/` folder.

## Hazards

### `ui-stop.js` sends a real SIGTERM to the user's dashboard

Exercising an install here against a live machine kills a dashboard you are using, and one that will
not die aborts the install outright. This file is currently byte-identical in all three plugin
variants and shares no code with `cli/`'s own `ui stop`. Detail:
[`../../../AGENTS.md`](../../../AGENTS.md#the-plugin-variants-are-near-copies-of-one-another)

### The containment guard is written differently in each variant

`installManifestFiles` here rejects an escaping destination with
`startsWith(resolvedRoot + path.sep)`. `claude-plugin/` uses a `path.relative` test instead, and that
is the prescribed idiom — the standard installer documents it as such. Before "aligning" any of them,
read the variant you are actually in.

### `cmpSemver` is local to this file and is not the sibling's

Each plugin variant carries its own version comparator with its own prerelease handling. A change to
downgrade behaviour here changes nothing in the other two, and a statement about downgrade behaviour
that is written once for "the plugin installers" is wrong somewhere.

## When a change here ripples

- **Changed the manifest shape, a destination token, or which paths are protected?** The catalog
  this folder reads is **hand-authored for the `runtime-config/` half** — no drift gate — and
  uninstall removes only what one records. The documentation-corpus half is generated: the build's
  `merge-docs-manifest` step folds it into the `output/manifests/` copy the install actually loads,
  and the committed file never carries it. `../../tests/manifest-payload-parity.test.mjs` compares
  the built `_install-source/` tree against that built catalog in both directions and is the only
  thing that catches a mismatch. Detail: [`runtime-config/AGENTS.md`](../../../../runtime-config/AGENTS.md),
  [`../../../AGENTS.md`](../../../AGENTS.md)

- **Changed `install.json`'s shape, the entry builder, or the coexistence probe?** The standard
  installer and the two sibling plugins write the same file, and `cli/` reads it to report what is
  installed. A shape change on one side is invisible until a user has two channels installed. Detail:
  [`../../../standard/lib/install/AGENTS.md`](../../../standard/lib/install/AGENTS.md),
  [`cli/AGENTS.md`](../../../../cli/AGENTS.md)

- **Fixed a bug in any file here?** The other two plugin variants carry their own copy of the same
  module and nothing links them — no shared module, no cross-variant test — so the fix reaches one
  release channel and the same bug ships on the other two. Open the sibling files, decide per
  variant whether the fix applies, and say which ones you cleared. Detail:
  [`../../../AGENTS.md`](../../../AGENTS.md)

## Commands

```
npm test -w harness-installers/copilot-cli-plugin
node --test harness-installers/copilot-cli-plugin/tests/run-install.test.mjs
```

**Never exercise a change against your real home directory.** `~/.radorc/` is not sandboxed, the
removal paths delete, and `ui-stop.js` will kill a dashboard you are using. Every suite here injects
a temp home; do the same.

## Further reading

- [`../../../AGENTS.md`](../../../AGENTS.md) — the shared plugin install shape and its hazards
- [`../../hooks/AGENTS.md`](../../hooks/AGENTS.md) — the hook that calls `runInstall`
- [`../../../standard/lib/install/AGENTS.md`](../../../standard/lib/install/AGENTS.md) — the other
  channel writing the same `install.json`
- [`runtime-config/AGENTS.md`](../../../../runtime-config/AGENTS.md) — the only source these
  manifests catalog
