# `harness-installers/copilot-vscode-plugin/`

The Copilot in VS Code marketplace channel. `build-scripts/build.js` produces a publishable plugin
payload under `output/`; the source package (`@rad-orchestration/copilot-vscode-plugin-source`) is
never published, and `npm pack` runs against `output/`.

> **The shared plugin shape — the install-side guarantees and the
> change-one-change-all-three obligation — lives in
> [`../AGENTS.md`](../AGENTS.md#the-plugin-variants-are-near-copies-of-one-another).** Read it
> before your first change in any plugin variant. This file carries only what is different here, and
> this variant differs the most.

## How it works

| Path | Holds |
|---|---|
| [`build-scripts/`](./build-scripts/AGENTS.md) | `build.js`, `validate.js`, `synthesize-package-json.js` |
| `.claude-plugin/plugin.json` | Plugin metadata in **Claude-format layout**, name `rad-orc-vscode`; its `version` is the authoritative version for the published package |
| [`hooks/`](./hooks/AGENTS.md) | Hook sources and this variant's registrations. **Ships to end users** |
| [`lib/install/`](./lib/install/AGENTS.md) | The install state machine plus `bake-paths.js`, inlined into `hooks/bootstrap.mjs` at build time |
| `manifests/` | One hand-authored `v<version>.json` path catalog, covering `runtime-config/` only — the build merges the generated docs entries into the `output/` copy |
| `output/` · `dogfood-marketplace/` | Gitignored |

What is different here, against the other two variants:

| | This variant | Elsewhere |
|---|---|---|
| Plugin metadata | `.claude-plugin/plugin.json`, name `rad-orc-vscode` | root `plugin.json` in `copilot-cli-plugin/` |
| Published package | `@rad-orchestration/copilot-vscode-plugin` | — |
| Agent filenames | `agents/<name>.agent.md` | `<name>.md` in `claude-plugin/` |
| Agent namespacing | none — `agentNames` is not passed to `expandTokens` | `rad-orc:<name>` in `claude-plugin/` only |
| Token target | `${COPILOT_VSCODE_PLUGIN_ROOT}`, then **baked to an absolute path at install time** | left as a runtime token in both other variants |
| Hook events | PascalCase — `UserPromptSubmit`, `SessionStart` | camelCase in `copilot-cli-plugin/` |
| Hook dispatch | inline `node -e` shim reading `CLAUDE_PLUGIN_ROOT` | `hooks/launcher.cjs` in `copilot-cli-plugin/` |
| Telemetry | shim ships, **nothing registers it** | registered in `claude-plugin/` only |
| `install.json` key | `copilot-vscode-plugin`; coexistence partners `copilot-vscode`, `copilot-cli`, `copilot-cli-plugin` | see each variant |
| Model identifier shape | `(copilot)`-suffixed, **emitted upstream by the adapter** — the build never rewrites a model id | — |

## Conventions

- **Keep the manifest in Claude-format layout.** See the hazard below; moving `plugin.json` to the
  payload root to match the CLI sibling breaks hook dispatch outright.
- **No agent namespacing.** `expandTokens` is called without `agentNames`.
- **Nothing here reaches into a sibling installer.** The bake step, the three-partner coexistence
  warning, and the manifest layout are all local to this package by design.

## Hazards

### Claude-format layout is what makes hooks locatable, and it is not cosmetic

VS Code gates plugin-root discovery on the **format it infers from the manifest's location**, not on
the plugin's runtime target. A manifest at `.claude-plugin/plugin.json` is detected as Claude format
and gets `CLAUDE_PLUGIN_ROOT` injected into the hook process; a manifest at the payload root is
detected as Copilot format, for which the documented plugin-root entry is *(not defined)* — no env
var, no `${…}` substitution. Observed directly when this variant tried it: the hook was spawned with
`process.cwd()` set to the workspace folder, no plugin-root variable in the environment, and
`${CLAUDE_PLUGIN_ROOT}` surviving literally into PowerShell, which then mis-parsed it.

The CLI sibling keeps the root-`plugin.json` layout because its own runtime *does* inject a plugin
root for Copilot format. The two layouts are not interchangeable and neither is a style choice.

### Skill tokens must be baked here, and only here

`${PLUGIN_ROOT}` is meant to be expanded by the harness runtime at the moment a `SKILL.md` shell
block runs. VS Code injects a plugin root only into **hook** processes — the agent's chat shell,
where those blocks actually execute, gets nothing, whatever the manifest format. So the literal
token would reach the shell and evaluate to empty.

`lib/install/bake-paths.js` closes that gap: after `runInstall` succeeds, `bootstrap.mjs` rewrites
the token to the real absolute install path across the payload's skill files. The other two variants
do not need it and do not have it. Deleting it "for symmetry" breaks every command in every skill on
this channel, with no build error.

**The bake reaches Markdown under `skills/` and nothing else.** A token written anywhere else in the
payload — a hook file, an action-event file, a communication style, a tier template — ships literally
to the user's disk, and nothing tests that.

### The plugin's chat namespace comes from a folder name, not from `plugin.json`

VS Code's plugin loader derives the `/<namespace>:<skill>` prefix from the **basename of the catalog
entry's `source.path`** — the folder the payload is cloned into — not from this package's
`plugin.json` `name` and not from the catalog entry's `plugins[].name`. Claude Code and Copilot CLI
both read the name from the manifest, so this quirk is VS-Code-only, and it stays invisible for as
long as a catalog keeps `plugins[].name` equal to `basename(source.path)`.

**A rename therefore moves several files at once**, and missing one leaves a stale path or a
duplicate entry in the Agent Plugins panel:

- the satellite payload folder
- the catalog entry's `plugins[].name` **and** `source.path`
- this package's `.claude-plugin/plugin.json` `name`
- the hook error-prefix strings in `hooks/hooks.json`
- the synthetic plugin trees built by `tests/*.test.mjs`
- the release sync mapping in `.claude/skills/rad-release/scripts/sync-satellite-and-tag.mjs` —
  its `PLUGINS[]` entries are `{src, harness}`, and the satellite destination is derived as
  `<satellite>/<TOOL>/<harness>`

The folder name `copilot-vscode-plugin/` is internal only. Build scripts and tests pin it, it never
reaches users, and it deliberately differs from the satellite folder name.

### VS Code caches catalog data outside the cloned tree

After a satellite rename or republish, expect duplicate panel entries or a
`Plugin source '<old-path>' not found after cloning` failure. Deleting the cloned marketplace tree is
not enough — the Copilot Chat extension also keeps the fetched catalog, the per-marketplace list, the
marketplace-to-path index, and a fetch-throttle timestamp in VS Code's global SQLite state, and it
will trust those. **Close VS Code first** (it holds an exclusive lock on that database and file locks
on the clones), then clear the cloned tree, the installed-plugin tracking file, and those state keys
before reopening.

## When a change here ripples

- **Changed a build step, `validate.js`, or what the payload contains?** The other two plugin builds
  run the same step sequence, and the structural guards in `shared/build-helpers/tests/` read every
  builder's source text — a reordering here can fail on behalf of a builder you never opened.
  Detail: [`build-scripts/AGENTS.md`](./build-scripts/AGENTS.md), [`../AGENTS.md`](../AGENTS.md)

- **Changed where `${PLUGIN_ROOT}` is written in canonical source?** The token travels
  `harness-files/` → the adapters (which pass it through untouched) → this build's `expand-tokens`
  → `bake-paths.js` at install time. A token introduced outside the payload's `skills/` Markdown
  completes the first three hops and silently fails the fourth. Detail:
  [`harness-files/AGENTS.md`](../../harness-files/AGENTS.md),
  [`harness-adapters/AGENTS.md`](../../harness-adapters/AGENTS.md),
  [`lib/install/AGENTS.md`](./lib/install/AGENTS.md)

- **Renamed the plugin, the satellite folder, or the catalog entry?** See the namespace hazard above
  — the release sync mapping and the marketplace catalog both have to move in the same change.
  Detail: [`.claude/skills/rad-release/SKILL.md`](../../.claude/skills/rad-release/SKILL.md)

## Commands

```
node harness-installers/copilot-vscode-plugin/build-scripts/build.js
npm test -w harness-installers/copilot-vscode-plugin
```

To exercise a real install, run the **`/rad-dogfood-plugin`** skill and pick `copilot-vscode`.
**Never run `hooks/bootstrap.mjs` by hand against your own home directory** — it writes to
`~/.radorc/`, stops a running dashboard, rewrites `hooks.json`, and bakes absolute paths into skill
files. The suites inject a temp home.

## Further reading

- [`../AGENTS.md`](../AGENTS.md) — the shared plugin shape, the manifest discipline, and the
  cross-variant obligation
- [`build-scripts/AGENTS.md`](./build-scripts/AGENTS.md) — this build's deltas and its gates
- [`hooks/AGENTS.md`](./hooks/AGENTS.md) — registrations and the inline shim
- [`lib/install/AGENTS.md`](./lib/install/AGENTS.md) — the install state machine and the bake step
- [`harness-adapters/AGENTS.md`](../../harness-adapters/AGENTS.md) — where the `(copilot)`-suffixed
  model identifiers come from
