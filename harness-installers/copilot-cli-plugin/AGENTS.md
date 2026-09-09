# `harness-installers/copilot-cli-plugin/`

The Copilot CLI marketplace channel. `build-scripts/build.js` produces a publishable plugin payload
under `output/`; the source package (`@rad-orchestration/copilot-cli-plugin-source`) is never
published, and `npm pack` runs against `output/`.

> **The shared plugin shape — the install-side guarantees and the
> change-one-change-all-three obligation — lives in
> [`../AGENTS.md`](../AGENTS.md#the-plugin-variants-are-near-copies-of-one-another).** Read it
> before your first change in any plugin variant. This file carries only what is different here.

## How it works

| Path | Holds |
|---|---|
| [`build-scripts/`](./build-scripts/AGENTS.md) | `build.js`, `validate.js`, `synthesize-package-json.js` |
| `plugin.json` | Plugin metadata **at the package root**, name `rad-orc`, with a `"hooks": "hooks/hooks.json"` pointer; its `version` is the authoritative version for the published package |
| [`hooks/`](./hooks/AGENTS.md) | Hook sources, `launcher.cjs`, and this variant's registrations. **Ships to end users** |
| [`lib/install/`](./lib/install/AGENTS.md) | The install state machine, inlined into `hooks/bootstrap.mjs` at build time |
| `manifests/` | One hand-authored `v<version>.json` path catalog, covering `runtime-config/` only — the build merges the generated docs entries into the `output/` copy |
| `output/` · `dogfood-marketplace/` · `.expand-staging/` | Gitignored |

What is different here, against the other two variants:

| | This variant | Elsewhere |
|---|---|---|
| Plugin metadata | `plugin.json` at the payload root — Copilot format | `.claude-plugin/plugin.json` in both other variants |
| Published package | `@rad-orchestration/copilot-cli-plugin` | — |
| Agent filenames | `agents/<name>.agent.md` | `<name>.md` in `claude-plugin/` |
| Agent namespacing | none — `agentNames` is not passed to `expandTokens` | `rad-orc:<name>` in `claude-plugin/` only |
| Token target | `${COPILOT_CLI_PLUGIN_ROOT}` | `${CLAUDE_PLUGIN_ROOT}` · `${COPILOT_VSCODE_PLUGIN_ROOT}` |
| Hook events | camelCase — `userPromptSubmitted`, `sessionStart` | PascalCase in both other variants |
| Hook dispatch | `node hooks/launcher.cjs <target>.mjs`, resolving through `COPILOT_PLUGIN_ROOT` | inline `node -e` shims reading `CLAUDE_PLUGIN_ROOT` |
| Telemetry | shim ships, **nothing registers it** | registered in `claude-plugin/` only |
| `install.json` key | `copilot-cli-plugin`; coexistence partners `copilot-cli`, `copilot-vscode` | see each variant |

The `plugin.json` layout is deliberate: the Copilot CLI runtime injects `COPILOT_PLUGIN_ROOT` into
the hook process for a Copilot-format plugin, which is exactly what `launcher.cjs` reads. The VS Code
sibling cannot use this layout — see [`../copilot-vscode-plugin/AGENTS.md`](../copilot-vscode-plugin/AGENTS.md).

## Conventions

- **Keep this variant Copilot-format.** Moving `plugin.json` under `.claude-plugin/` to match a
  sibling changes how the runtime detects the plugin and which root variable it injects.
- **No agent namespacing.** `expandTokens` is called without `agentNames`, so it performs token
  substitution only. Adding the argument would rewrite agent references the Copilot CLI does not
  resolve.
- **`validatePluginTree`'s `REQUIRED_ARTIFACTS` is the contract with the build.** `validate` runs
  last, so a mismatch costs a full build to discover.

## Hazards

### Telemetry ships here and is wired to nothing

`emitHookBundle` stages `telemetry-capture.mjs` into `output/hooks/` for every variant, and this
variant's `hooks.json` registers no telemetry event. Do not write parity language into a doc, a
comment, or a release note on the strength of the shim shipping.

### `drift-check.mjs` does not simply write a line to stdout

Copilot CLI discards a hook's raw stdout. Under `COPILOT_CLI=1` the drift line is emitted as
`{"additionalContext": …}` — a **bare** top-level key, which is this runtime's shape and not the
nested one the other two variants use. Off-CLI it falls back to a raw line, which is what the tests
see. A statement about "the drift check prints a line" is true only of `claude-plugin/`.

### This variant's `hooks.json` depends on a file the build does not gate

Every command string dispatches through `hooks/launcher.cjs`. `emitHookBundle` copies it verbatim
from a hardcoded list, and `REQUIRED_ARTIFACTS` does not name it — so renaming or removing it passes
`validate` and fails on a user's machine at the first prompt.

## When a change here ripples

- **Changed a build step, `validate.js`, or what the payload contains?** The other two plugin builds
  run the same step sequence, and the structural guards in `shared/build-helpers/tests/` read every
  builder's source text — a reordering here can fail on behalf of a builder you never opened.
  Detail: [`build-scripts/AGENTS.md`](./build-scripts/AGENTS.md), [`../AGENTS.md`](../AGENTS.md)

- **Changed which hook events are registered, or how a command resolves its root?**
  `session-preamble.mjs` is single-sourced in `shared/hooks/`, is dispatched here through
  `launcher.cjs`, and fails silently by contract — the session simply loads without ambient
  awareness. Fix the shim in `shared/hooks/` rather than in this variant, and rebuild — `node
  harness-installers/copilot-cli-plugin/build-scripts/build.js` — before you test, since
  `output/hooks/` is only restaged by a build. Detail: [`hooks/AGENTS.md`](./hooks/AGENTS.md),
  [`../shared/hooks/AGENTS.md`](../shared/hooks/AGENTS.md)

## Commands

```
node harness-installers/copilot-cli-plugin/build-scripts/build.js
npm test -w harness-installers/copilot-cli-plugin
```

To exercise a real install, run the **`/rad-dogfood-plugin`** skill and pick `copilot-cli`. **Never
run `hooks/bootstrap.mjs` by hand against your own home directory** — it writes to `~/.radorc/`,
stops a running dashboard, and rewrites `hooks.json`. The suites inject a temp home.

## Further reading

- [`../AGENTS.md`](../AGENTS.md) — the shared plugin shape, the manifest discipline, and the
  cross-variant obligation
- [`build-scripts/AGENTS.md`](./build-scripts/AGENTS.md) — this build's deltas and its gates
- [`hooks/AGENTS.md`](./hooks/AGENTS.md) — registrations and the launcher
- [`lib/install/AGENTS.md`](./lib/install/AGENTS.md) — the install state machine
- [`../shared/build-helpers/AGENTS.md`](../shared/build-helpers/AGENTS.md) — the helpers this build
  calls
