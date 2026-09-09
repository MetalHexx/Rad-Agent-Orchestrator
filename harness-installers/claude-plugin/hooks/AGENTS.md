# `harness-installers/claude-plugin/hooks/`

The hook sources for the Claude plugin, and `hooks.json` — the file that decides which of them ever
fire. Registration is owned here; the shims themselves mostly are not.

> **This folder is published.** `emitHookBundle` copies `hooks.json`, `drift-check.mjs`, and **this
> `AGENTS.md`** verbatim into `output/hooks/`, and `hooks/` is in the tarball's `files` list, so
> everything here lands on a stranger's machine. No OS usernames, no org handles, no internal
> hostnames, no ticket keys. Same rule the root `AGENTS.md` states for `docs/`.

## How it works

`hooks.json` is the whole registration surface for this variant:

| Event | Dispatches to | Authored |
|---|---|---|
| `UserPromptSubmit` | `bootstrap.mjs` | here |
| `SessionStart` | `drift-check.mjs`, then `session-preamble.mjs` | here · [`shared/hooks/`](../../shared/hooks/AGENTS.md) |
| `PostToolUse`, `Stop`, `SessionEnd` | `telemetry-capture.mjs` | [`shared/hooks/`](../../shared/hooks/AGENTS.md) |

`session-preamble.mjs` and `telemetry-capture.mjs` are **single-sourced** in `shared/hooks/` and
staged into `output/hooks/` by the build. They are not in this folder and must never be copied into
it — fix them at the source.

Every command string is an inline `node -e` shim that reads `process.env.CLAUDE_PLUGIN_ROOT`,
normalizes a leading `/<drive>/…` form to `<DRIVE>:/…`, writes it back to the environment, and
dynamic-imports the target through `pathToFileURL`.

`bootstrap.mjs` runs the install and then removes its own registration; `drift-check.mjs` is
persistent and never self-uninstalls. What `bootstrap.mjs` actually installs is
[`../lib/install/AGENTS.md`](../lib/install/AGENTS.md).

## Conventions

- **`bootstrap.mjs` is bundled; everything else here is copied verbatim.** esbuild inlines
  `../lib/install/*` into a single self-contained `output/hooks/bootstrap.mjs`, so new imports need
  no build-script change. `drift-check.mjs` gets no such treatment — **Node built-ins only**, or it
  ships broken.
- **No backslash literals in the inline shim.** Every escaping layer between `hooks.json` and the
  spawned process (JSON decode, shell quoting, `cmd /d /s /c`) collapses them differently. Forward
  slashes work everywhere Node accepts a path. `tests/hooks-shim.test.mjs` pins the shape and runs
  the live command string through both `bash -c` and the OS-default shell.
- **`bootstrap.mjs` and `drift-check.mjs` take their roots from the environment**, never from a
  working-directory-relative path.
- **Registration is per-variant.** `copilot-cli-plugin/` is the one that differs in mechanism — its
  event names are camelCase and its commands dispatch through `hooks/launcher.cjs`.
  `copilot-vscode-plugin/` uses PascalCase names too and reads the same `CLAUDE_PLUGIN_ROOT`, but
  registers only `UserPromptSubmit` and `SessionStart` — no telemetry events — wraps each entry
  differently, never writes the normalized root back to the environment, and carries its own
  not-injected diagnostic. Copying an entry between any two of them still does not work.

## Hazards

### `selfUninstall` deletes exactly one key, matched exactly

On success `bootstrap.mjs` reads `hooks/hooks.json`, deletes `hooks.UserPromptSubmit`, and renames a
tmp file into place. The delete is a literal property lookup: rename or re-case the event on either
side and it silently no-ops, the entry survives, and the bootstrap re-runs a full install on **every
prompt of every session**. Nothing errors — the install is idempotent, so the symptom is latency, not
a failure.

It also refuses to touch `hooks.json` at all unless the plugin root is under the harness's own plugin
cache directory, so a dogfood marketplace tree staged elsewhere is never clobbered.

### The telemetry entries are Claude-only, and `PostToolUse` carries no matcher

This is the only variant whose `hooks.json` registers `telemetry-capture.mjs`. The shim is staged
into every plugin payload; neither Copilot variant wires it to an event. Do not write parity
language anywhere on the strength of the shim shipping.

The `PostToolUse` entry deliberately has **no `matcher`** — it fires on every tool. Any doc or
comment claiming `matcher: "Agent"` is stale.

### A shim failure is invisible by design

`session-preamble.mjs` degrades to a one-line "ambient awareness did not load" notice and exits 0;
`telemetry-capture.mjs` swallows everything and forces exit 0. A wrong path, a renamed subcommand, or
an unregistered event produces no build error, no test failure, and nothing a user would report.

## When a change here ripples

- **Changed `hooks.json` — an event, a dispatch target, or the shim string?** `output/hooks/hooks.json`
  is a verbatim copy, so the change only reaches anything after a rebuild, and
  `tests/hooks-output-parity.test.mjs` fails until source and emitted output agree. Detail:
  [`../AGENTS.md`](../AGENTS.md)

- **Changed what a shared shim expects from its environment, or which subcommand it calls?**
  `session-preamble.mjs` and `telemetry-capture.mjs` belong to `shared/hooks/`, are wired by this
  variant's `hooks.json` and by the standard installer's `settings.json` merge, and fail
  silently on a user's machine. Change the shim in `shared/hooks/`, then confirm this variant's
  `hooks.json` and that merge still name the same command. Detail:
  [`../../shared/hooks/AGENTS.md`](../../shared/hooks/AGENTS.md),
  [`cli/AGENTS.md`](../../../cli/AGENTS.md)

- **Added a per-plugin file to this folder?** `emitHookBundle` copies a hardcoded list —
  `drift-check.mjs`, `hooks.json`, `launcher.cjs`, `AGENTS.md` — and silently skips anything else. A
  new file here never reaches `output/`. Detail:
  [`../../shared/build-helpers/AGENTS.md`](../../shared/build-helpers/AGENTS.md)

## Commands

```
node --test harness-installers/claude-plugin/tests/hooks-shim.test.mjs
node --test harness-installers/claude-plugin/tests/hooks-output-parity.test.mjs
npm test -w harness-installers/claude-plugin
```

**Never run `bootstrap.mjs` directly against your own home directory.** It writes into `~/.radorc/`,
stops a running dashboard, and rewrites a `hooks.json`. Use the suites, which inject a temp home, or
the `/rad-dogfood-plugin` skill.

## Further reading

- [`../../shared/hooks/AGENTS.md`](../../shared/hooks/AGENTS.md) — the shims this variant
  registers but does not own
- [`../lib/install/AGENTS.md`](../lib/install/AGENTS.md) — what `bootstrap.mjs` runs
- [`docs/internals/ambient-awareness.md`](../../../docs/internals/ambient-awareness.md) — what the
  `SessionStart` preamble carries
- [`../AGENTS.md`](../AGENTS.md) — this variant's deltas
