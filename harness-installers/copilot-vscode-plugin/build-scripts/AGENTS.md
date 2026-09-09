# `harness-installers/copilot-vscode-plugin/build-scripts/`

Build orchestration for the Copilot in VS Code plugin. `build.js` exports `runBuild(opts)` and is the
single entry point; `validate.js` is the final gate and `synthesize-package-json.js` writes the
payload's `package.json`.

> **The step sequence is identical in all three plugin builders — read it off `build.js` itself,
> which names each step in execution order.** The shared obligations that sequence carries are in
> [`../../AGENTS.md`](../../AGENTS.md#the-plugin-variants-are-near-copies-of-one-another); this
> file carries only the deltas.

## How it works

What differs from the sibling builders:

| | Here |
|---|---|
| `adapter-engine` | `--harness=copilot-vscode` |
| `step()` prefix | `[build:copilot-vscode-plugin]` |
| `expand-tokens` | `${SKILLS_ROOT}` → `${COPILOT_VSCODE_PLUGIN_ROOT}/skills`, `${PLUGIN_ROOT}` → `${COPILOT_VSCODE_PLUGIN_ROOT}`; `agentNames` is **not** passed, so no agent namespacing |
| `copy-plugin-manifest` | `.claude-plugin/plugin.json` → `output/.claude-plugin/plugin.json` — Claude-format layout, and the reason hooks can locate themselves at all |
| `synthesize-package-json` | hardcodes `@rad-orchestration/copilot-vscode-plugin` and the `files` allowlist |
| `emit-hook-bundle` | no launcher ships — this variant's `hooks.json` dispatches through an inline `node -e` shim |

`validate.js` gates on required artifacts, then on `.claude-plugin/plugin.json` carrying a non-empty
`version` string, then on every canonical agent appearing at `output/agents/<name>.agent.md`, then on
`manifests/v<version>.json` being present, then on the packed size budget. **No variant has a
namespaced-token gate** — the Claude builder's gate numbering skips a value, which is not the same
thing as a gate existing.

The model identifier shape VS Code's resolver requires is emitted **upstream by the adapter engine**.
Nothing in this build translates or rewrites a model id.

## Conventions

- **Fixed step order; no conditional reordering.** `skipAdapterEngine` and `skipBootstrap` bypass
  their step outright for synthetic fixture and unit builds. **`skipUiRunner` bypasses nothing** —
  `emit-ui-bundle` still runs, with only the `next build` inside it stubbed, so it writes a real but
  minimal `ui.tgz`; do not reach for it expecting the step to be skipped. None of them may be used to
  reorder the steps that do run. Adapter output must exist before `copy-agents`/`copy-skills`, the
  bundles before `expand-tokens`, and `validate` last.
- **There is no per-package bootstrap step**, and adding one breaks a guard —
  `shared/build-helpers/tests/no-per-package-bootstrap.test.mjs` asserts no builder contains a
  `bootstrap-deps` step or a `BOOTSTRAP_TARGETS` constant. The repo installs once at the root.
- **`build-lib-dist` must precede `emit-cli-bundle` and `emit-ui-bundle`**, building
  `repo-registry` → `work-graph` → `telemetry` → `terminal-launch` in that order.
  `shared/build-helpers/tests/build-lib-dist-order.test.mjs` pins the precedence in every builder,
  but its expected list stops at `telemetry` — `terminal-launch`'s position is unguarded, so keep it
  last by hand.
- **`custom/` ships as an empty directory.** `copy-action-events` and `copy-communication-styles`
  each filter out everything inside the slot so an install never clobbers a user's overlay. A change
  to either step must preserve the filter.
- **`REQUIRED_ARTIFACTS` is the contract with `build.js`.** A step that starts emitting a
  load-bearing artifact adds it here in the same change.

## Hazards

### `copy-plugin-manifest`'s destination is load-bearing, not layout preference

Writing `plugin.json` to the payload root instead — matching the CLI sibling — makes VS Code detect
the plugin as Copilot format, which has no documented plugin-root discovery mechanism. Hooks then
have no way to locate their own payload. See the hazard in [`../AGENTS.md`](../AGENTS.md).

### `validate` is the last step, so its failures are expensive

A filename-convention change — an adapter emitting a different agent suffix, say — surfaces here
after the adapter engine, both bundles, and the UI build have already run.

### `.expand-staging/` survives a throw, and this variant does not gitignore it

`expand-tokens` writes `<variant>/.expand-staging/` and removes it on both sides of the step, but not
on a failure, and the release flow stages with `git add -A`. See the hazard in
[`../../AGENTS.md`](../../AGENTS.md).

## When a change here ripples

- **Added, removed, or reordered a step?** The structural guards in `shared/build-helpers/tests/`
  read every builder's source text, so a change here can fail on behalf of a builder you never
  opened — and the reverse. Detail:
  [`../../shared/build-helpers/AGENTS.md`](../../shared/build-helpers/AGENTS.md),
  [`../../AGENTS.md`](../../AGENTS.md)

- **Changed what a step writes into `output/_install-source/`?** The committed catalog is
  hand-authored and nothing regenerates it; `merge-docs-manifest` generates the documentation half
  into the `output/manifests/` copy alone. `../tests/manifest-payload-parity.test.mjs` compares the
  built tree against that built catalog in both directions and is the only thing that notices. Detail:
  [`runtime-config/AGENTS.md`](../../../runtime-config/AGENTS.md), [`../AGENTS.md`](../AGENTS.md)

- **Changed the `expand-tokens` token map?** `lib/install/bake-paths.js` substitutes the exact token
  literal this step produces, at install time. Change one side and the bake finds nothing to do,
  leaving the literal token in every shipped skill file — no build error, no test failure. Detail:
  [`../lib/install/AGENTS.md`](../lib/install/AGENTS.md)

- **Changed the `.agent.md` suffix gate 2 pins?** It has to match what this harness's adapter
  `filenames` template emits, and nothing checks the pair — a mismatch aborts the build at the last
  step, after everything else has already run. Move the adapter in the same change. Detail:
  [`harness-adapters/AGENTS.md`](../../../harness-adapters/AGENTS.md)

## Commands

```
node harness-installers/copilot-vscode-plugin/build-scripts/build.js
npm test -w harness-installers/copilot-vscode-plugin
node --test harness-installers/shared/build-helpers/tests/*.test.mjs
```

## Further reading

- [`../../AGENTS.md`](../../AGENTS.md) — the shared plugin shape and the manifest discipline
- [`../AGENTS.md`](../AGENTS.md) — this variant's deltas, including why the manifest layout is what
  it is
- [`../../shared/build-helpers/AGENTS.md`](../../shared/build-helpers/AGENTS.md) — the helpers these
  steps call
- [`harness-adapters/AGENTS.md`](../../../harness-adapters/AGENTS.md) — what produces this build's
  input, including the model identifier shape
