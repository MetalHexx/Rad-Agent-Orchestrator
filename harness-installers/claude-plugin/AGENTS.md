# `harness-installers/claude-plugin/`

The Claude marketplace channel. `build-scripts/build.js` produces a publishable plugin payload under
`output/`; the source package (`@rad-orchestration/claude-plugin-source`) is never published, and
`npm pack` runs against `output/`.

> **The shared plugin shape — the install-side guarantees and the
> change-one-change-all-three obligation — lives in
> [`../AGENTS.md`](../AGENTS.md#the-plugin-variants-are-near-copies-of-one-another).** Read it
> before your first change in any plugin variant. This file carries only what is different here.

## How it works

| Path | Holds |
|---|---|
| `build-scripts/` | `build.js`, `validate.js`, `synthesize-package-json.js`, and `parity-check.js` |
| `.claude-plugin/plugin.json` | Plugin metadata; its `version` is the authoritative version for the published package |
| [`hooks/`](./hooks/AGENTS.md) | Hook sources, and the registrations for this harness. **Ships to end users** |
| [`lib/install/`](./lib/install/AGENTS.md) | The install state machine, inlined into `hooks/bootstrap.mjs` at build time |
| `manifests/` | One hand-authored `v<version>.json` path catalog, covering `runtime-config/` only — the build merges the generated docs entries into the `output/` copy |
| `output/` · `dogfood-marketplace/` | Gitignored build payload and the ephemeral local marketplace |

There is no `build-scripts/AGENTS.md` here. `build-scripts/build.js` names each step in execution
order and runs the same sequence in all three plugin variants; what differs per variant is small
enough to list below.

What is different here, against the other two variants:

| | This variant | The Copilot variants |
|---|---|---|
| Plugin metadata | `.claude-plugin/plugin.json`, name `rad-orc` | `plugin.json` at the payload root (CLI) · `.claude-plugin/plugin.json`, name `rad-orc-vscode` (VS Code) |
| Published package | `@rad-orchestration/claude-plugin` | `@rad-orchestration/copilot-{cli,vscode}-plugin` |
| Agent filenames | `agents/<name>.md` | `agents/<name>.agent.md` |
| Agent namespacing | `rad-orc:<name>` — the only variant that passes `agentNames` to `expandTokens` | none |
| Token target | `${CLAUDE_PLUGIN_ROOT}` | `${COPILOT_CLI_PLUGIN_ROOT}` · `${COPILOT_VSCODE_PLUGIN_ROOT}` |
| Telemetry | **registers** the telemetry shim, as in `standard/` | shim ships, nothing wires it |
| `~/.radorc/telemetry/` protection | present, as in `standard/` | absent |
| `install.json` key | `claude-plugin`, coexistence partner `claude` | see each variant's file |

## Conventions

- **`validatePluginTree`'s `REQUIRED_ARTIFACTS` is the contract with the build.** Add a step that
  emits a new required artifact and add it to the list in the same change; `validate` runs last, so
  a mismatch costs a full build to discover.
- **`synthesizePackageJson` hardcodes the published name and the `files` allowlist.** Anything the
  build starts emitting outside those top-level folders is silently absent from the tarball.
- **`build-scripts/parity-check.js` is a retired one-shot.** It diffed this payload against the
  pre-greenfield plugin output during migration. Its only driver is
  `tests/parity-validation.test.mjs`, which skips unless `RUN_PARITY=1`, so no CI job ever runs it.
  Do not treat a green run of it as a gate, and do not extend it.

## Hazards

### Telemetry runs on this plugin channel and neither Copilot one

`hooks/hooks.json` here wires `PostToolUse`, `Stop`, and `SessionEnd` to `telemetry-capture.mjs`.
Neither Copilot variant's `hooks.json` wires it to any event, even though every build stages the
shim. **Never write parity language into a doc, a comment, or a release note** — "the shim ships
everywhere" is not "telemetry runs everywhere".

The `PostToolUse` entry deliberately carries **no `matcher`**: it fires on every tool, not only
`Agent`, so main-agent spend is harvested mid-turn rather than only at `Stop`. Any doc or comment
claiming a matcher is stale.

### The `~/.radorc/telemetry/` skip is absent from both Copilot plugin variants

`lib/install/user-data-paths.js` here returns a `telemetry` key and `lib/install/remove-files.js`
skips anything resolving under it, guarded by `tests/telemetry-sacred-folder.test.mjs`. The standard
installer carries the same pair; `copilot-cli-plugin/` and `copilot-vscode-plugin/` carry neither
half. Do not describe it as a protection every installer variant has.

### This variant's extra suites guard this variant only

`tests/hooks-output-parity.test.mjs`, `tests/hooks-shim.test.mjs`,
`tests/telemetry-sacred-folder.test.mjs`, `tests/build-e2e.test.mjs`, and
`tests/parity-validation.test.mjs` exist nowhere else. `hooks-output-parity` in particular reads like
*the* source↔output parity gate for plugin hook bundles and is not — it builds this plugin's hook
bundle into a throwaway target and compares `hooks.json`. A Copilot variant's `hooks.json` drifting
from its output is caught by nothing.

### `.expand-staging/` is not gitignored here

The `expand-tokens` step writes `.expand-staging/` in this folder and removes it on success. This
variant's `.gitignore` does not list it, and the release flow stages with `git add -A`. See the
hazard in [`../AGENTS.md`](../AGENTS.md).

## When a change here ripples

- **Changed a build step, `validate.js`, or what the payload contains?** The two Copilot builders run
  the same step sequence and the structural guards in `shared/build-helpers/tests/` read every
  builder's source text, so a reordering here can fail on behalf of a builder you never opened.
  Detail: [`../AGENTS.md`](../AGENTS.md),
  [`../shared/build-helpers/AGENTS.md`](../shared/build-helpers/AGENTS.md)

- **Changed which hook events are registered, or which shim an entry dispatches to?**
  `session-preamble.mjs` and `telemetry-capture.mjs` are not authored here — they are single-sourced
  in `shared/hooks/` and staged by `emitHookBundle`, and they fail silently by contract. Fix a shim
  in `shared/hooks/` rather than in this variant, and rebuild — `node
  harness-installers/claude-plugin/build-scripts/build.js` — before you test, since `output/hooks/`
  is only restaged by a build. Detail: [`hooks/AGENTS.md`](./hooks/AGENTS.md),
  [`../shared/hooks/AGENTS.md`](../shared/hooks/AGENTS.md)

## Commands

```
node harness-installers/claude-plugin/build-scripts/build.js
npm test -w harness-installers/claude-plugin
```

To exercise a real install, run the **`/rad-dogfood-plugin`** skill and pick `claude`. **Never run
`hooks/bootstrap.mjs` by hand against your own home directory** — it writes to `~/.radorc/`, stops a
running dashboard, and can rewrite a `hooks.json` you care about. The suites inject a temp home.

## Further reading

- [`../AGENTS.md`](../AGENTS.md) — the shared plugin shape, the manifest discipline, and the
  cross-variant obligation
- [`hooks/AGENTS.md`](./hooks/AGENTS.md) — what this variant registers, and the shim contract
- [`lib/install/AGENTS.md`](./lib/install/AGENTS.md) — the install state machine
- [`../shared/build-helpers/AGENTS.md`](../shared/build-helpers/AGENTS.md) — the helpers this build
  calls
- [`docs/internals/system-architecture.md`](../../docs/internals/system-architecture.md#from-canonical-source-to-your-machine)
  — how canonical source reaches a user's machine
