# `harness-installers/copilot-vscode-plugin/hooks/`

The hook sources for the Copilot in VS Code plugin, and `hooks.json` — the file that decides which of
them ever fire, and the only place path resolution happens.

> **This folder is published.** `emitHookBundle` copies `hooks.json`, `drift-check.mjs`, and **this
> `AGENTS.md`** verbatim into `output/hooks/`, and `hooks/` is in the tarball's `files` list, so
> everything here lands on a stranger's machine. No OS usernames, no org handles, no internal
> hostnames, no ticket keys. Same rule the root `AGENTS.md` states for `docs/`.

## How it works

`hooks.json` is the whole registration surface for this variant. Event names are **PascalCase** —
VS Code's native form, and deliberately not the camelCase the Copilot CLI sibling uses:

| Event | Dispatches to | Authored |
|---|---|---|
| `UserPromptSubmit` | `bootstrap.mjs` | here |
| `SessionStart` | `drift-check.mjs`, then `session-preamble.mjs` | here · [`shared/hooks/`](../../shared/hooks/AGENTS.md) |

Each command string is an **inline `node -e` shim** that reads `process.env.CLAUDE_PLUGIN_ROOT` —
the variable VS Code injects when it detects the plugin as Claude format, which is why the manifest
lives at `.claude-plugin/plugin.json`. The shim normalizes a leading `/<drive>/…` path form on
Windows, then dynamic-imports the target through an absolute file URL. If the variable is empty it
prints a diagnostic listing the plugin-, Copilot-, Claude-, and VS-Code-shaped environment keys it
did find and exits non-zero — that is the signal the plugin is being detected as the wrong format.

`session-preamble.mjs` and `telemetry-capture.mjs` are **single-sourced** in `shared/hooks/` and
staged into `output/hooks/` by the build. They are not in this folder and must never be copied into
it — fix them at the source.

`bootstrap.mjs` runs the install, bakes the plugin-root token across the payload's skill files, then
removes its own registration. `drift-check.mjs` is persistent and never self-uninstalls. What the
install and the bake actually do is [`../lib/install/AGENTS.md`](../lib/install/AGENTS.md).

## Conventions

- **`bootstrap.mjs` is bundled; everything else here is copied verbatim.** esbuild inlines
  `../lib/install/*` into a single self-contained `output/hooks/bootstrap.mjs`, so new imports need
  no build-script change. `drift-check.mjs` gets no such treatment — **Node built-ins only**, or it
  ships broken.
- **No `${…}` patterns and no backslash literals in the command string.** PowerShell reads `${VAR}`
  as its own expansion and chokes on the inner JS braces; backslashes collapse differently at each
  escaping layer. Env-var lookup plus forward slashes is the only shape that survives every shell.
- **Event names stay PascalCase.** Do not downcase them to match the CLI sibling.
- **`bootstrap.mjs` and `drift-check.mjs` self-resolve their plugin root** from `import.meta.url` and publish
  `COPILOT_VSCODE_PLUGIN_ROOT` for downstream modules, honouring an existing value so tests can
  redirect at a fixture root. The shim is where this folder's hook dispatch reads
  `CLAUDE_PLUGIN_ROOT`; the staged `session-preamble.mjs` and `telemetry-capture.mjs` read it too, to
  resolve the CLI bundle.

## Hazards

### `selfUninstall` deletes exactly one key, matched exactly

On success `bootstrap.mjs` reads `hooks/hooks.json`, deletes `hooks.UserPromptSubmit`, and renames a
tmp file into place; `SessionStart` must survive so the drift check keeps running. The delete is a
literal property lookup: rename or re-case the event on either side and it silently no-ops, the entry
survives, and the bootstrap re-runs a full install — including the bake — on every prompt of every
session. Nothing errors, because the install is idempotent.

The next upgrade ships a fresh `hooks.json` with `UserPromptSubmit` restored, which is what makes the
install re-run once per version.

### The bake runs between install and self-uninstall, and a throw skips both

`bootstrap.mjs` calls `bakeAbsolutePaths` after `runInstall` succeeds and before `selfUninstall`. If
either throws, `hooks.json` is left intact and the hook retries on the next prompt. Reordering the
two would leave a payload whose skills carry an unexpanded token and whose bootstrap will never fire
again.

### There is deliberately no launcher

A `launcher.cjs` dispatcher — the CLI sibling's approach — cannot work here: a relative
`node hooks/launcher.cjs …` resolves against the working directory, which VS Code sets to the
workspace folder, so the launcher would have to be located before its own location logic could run.
The inline shim carries its env-var lookup on the command line instead. Do not "simplify" this into a
launcher.

### Raw stdout is discarded by this runtime

`drift-check.mjs` cannot just print. It emits
`{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": …}}` — the **nested**
shape VS Code requires, and not the bare top-level key the Copilot CLI sibling uses. The same split
governs `session-preamble.mjs`'s output; see
[`docs/internals/ambient-awareness.md`](../../../docs/internals/ambient-awareness.md).

### Telemetry ships here and is wired to nothing

`telemetry-capture.mjs` is staged into `output/hooks/` by every plugin build. This variant's
`hooks.json` registers no telemetry event. Do not write parity language on the strength of the shim
shipping.

### A shim failure is invisible by design

`session-preamble.mjs` degrades to a one-line "ambient awareness did not load" notice and exits 0. A
wrong path, a renamed subcommand, or an unregistered event produces no build error and no test
failure.

## When a change here ripples

- **Changed `hooks.json` — an event, a dispatch target, or the shim string?** It is copied verbatim
  into `output/hooks/` at build time, so nothing changes until a rebuild, and unlike the Claude
  variant there is no source↔output parity suite here to notice a stale build. The
  `[rad-orc-vscode]` error prefix is inlined in each `node -e` dispatch in this file — not in a
  shared shim — so a plugin rename lands here. Detail: [`../AGENTS.md`](../AGENTS.md)

- **Changed what a shared shim expects from its environment, or which subcommand it calls?**
  `session-preamble.mjs` belongs to `shared/hooks/`, is wired by each plugin variant's own
  `hooks.json` plus the standard installer's `settings.json` merge, and fails silently on a user's
  machine. Change the shim in `shared/hooks/`, then confirm this variant's `hooks.json` and that
  merge still name the same command.
  Detail: [`../../shared/hooks/AGENTS.md`](../../shared/hooks/AGENTS.md),
  [`cli/AGENTS.md`](../../../cli/AGENTS.md)

- **Added a per-plugin file to this folder?** `emitHookBundle` copies a hardcoded list —
  `drift-check.mjs`, `hooks.json`, `launcher.cjs`, `AGENTS.md` — and silently skips anything else. A
  new file here never reaches `output/`. Detail:
  [`../../shared/build-helpers/AGENTS.md`](../../shared/build-helpers/AGENTS.md)

## Commands

```
node --test harness-installers/copilot-vscode-plugin/tests/bootstrap.test.mjs
node --test harness-installers/copilot-vscode-plugin/tests/drift-check.test.mjs
npm test -w harness-installers/copilot-vscode-plugin
```

**Never run `bootstrap.mjs` directly against your own home directory.** It writes into `~/.radorc/`,
stops a running dashboard, rewrites a `hooks.json`, and bakes absolute paths into skill files. Use
the suites, which inject a temp home, or the `/rad-dogfood-plugin` skill.

## Further reading

- [`../../shared/hooks/AGENTS.md`](../../shared/hooks/AGENTS.md) — the shim this variant registers
  but does not own
- [`../lib/install/AGENTS.md`](../lib/install/AGENTS.md) — what `bootstrap.mjs` runs, and the bake
- [`docs/internals/ambient-awareness.md`](../../../docs/internals/ambient-awareness.md) — the
  per-harness stdout contract the drift line and the preamble both obey
- [`../AGENTS.md`](../AGENTS.md) — this variant's deltas, and why the manifest layout is what it is
