# `harness-installers/copilot-cli-plugin/hooks/`

The hook sources for the Copilot CLI plugin, the dispatcher they are launched through, and
`hooks.json` — the file that decides which of them ever fire.

> **This folder is published.** `emitHookBundle` copies `hooks.json`, `launcher.cjs`,
> `drift-check.mjs`, and **this `AGENTS.md`** verbatim into `output/hooks/`, and `hooks/` is in the
> tarball's `files` list, so everything here lands on a stranger's machine. No OS usernames, no org
> handles, no internal hostnames, no ticket keys. Same rule the root `AGENTS.md` states for `docs/`.

## How it works

`hooks.json` is the whole registration surface for this variant. Event names are **camelCase** — the
Copilot CLI contract — and every command string is the same form:

| Event | Command | Target authored |
|---|---|---|
| `userPromptSubmitted` | `node hooks/launcher.cjs bootstrap.mjs` | here |
| `sessionStart` | `node hooks/launcher.cjs drift-check.mjs`, then `node hooks/launcher.cjs session-preamble.mjs` | here · [`shared/hooks/`](../../shared/hooks/AGENTS.md) |

**`launcher.cjs` is the dispatcher.** Copilot CLI spawns hook commands directly through `node`, not
through a shell, so no `%VAR%` or `$VAR` expansion is ever applied to the command string — an
env-var reference embedded in `hooks.json` would arrive literal. `launcher.cjs` therefore takes the
target script as `argv[2]`, builds an absolute path from `COPILOT_PLUGIN_ROOT` (injected by the
runtime, with `__dirname` as the fallback), and re-spawns it. The relative `node hooks/launcher.cjs`
prefix resolves against the process working directory the runtime chose.

`session-preamble.mjs` and `telemetry-capture.mjs` are **single-sourced** in `shared/hooks/` and
staged into `output/hooks/` by the build. They are not in this folder and must never be copied into
it — fix them at the source.

`bootstrap.mjs` runs the install and then removes its own registration; `drift-check.mjs` is
persistent and never self-uninstalls. What `bootstrap.mjs` actually installs is
[`../lib/install/AGENTS.md`](../lib/install/AGENTS.md).

## Conventions

- **`bootstrap.mjs` is bundled; everything else here is copied verbatim.** esbuild inlines
  `../lib/install/*` into a single self-contained `output/hooks/bootstrap.mjs`, so new imports need
  no build-script change. `drift-check.mjs` and `launcher.cjs` get no such treatment — **Node
  built-ins only**, or they ship broken.
- **Event names stay camelCase.** Do not align them with the PascalCase the other two variants use;
  the runtimes disagree and nothing validates the spelling.
- **`bootstrap.mjs` and `drift-check.mjs` self-resolve their plugin root** from `import.meta.url`,
  honouring an existing `COPILOT_CLI_PLUGIN_ROOT` so tests can redirect at a fixture root.
  `bootstrap.mjs` also publishes it back to the environment for the modules inlined into it;
  `drift-check.mjs` keeps it local. Never resolve a root from the working directory.

## Hazards

### `selfUninstall` deletes exactly one key, matched exactly

On success `bootstrap.mjs` reads `hooks/hooks.json`, deletes `hooks.userPromptSubmitted`, and renames
a tmp file into place. **There is no marker file** — idempotency lives in `hooks.json`, the same way
it does in both sibling variants. The delete is a literal property lookup: rename or re-case the
event on either side and it silently no-ops, the entry survives, and the bootstrap re-runs a full
install on every prompt of every session. Nothing errors, because the install is idempotent.

### Raw stdout is discarded by this runtime

`drift-check.mjs` cannot just print. Under `COPILOT_CLI=1` it emits `{"additionalContext": …}` — a
**bare** top-level key, this runtime's shape, not the nested `hookSpecificOutput` form the VS Code
sibling requires. Off-CLI it falls back to a raw line, which is what the tests observe. The same
split governs `session-preamble.mjs`'s output; see
[`docs/internals/ambient-awareness.md`](../../../docs/internals/ambient-awareness.md).

### Telemetry ships here and is wired to nothing

`telemetry-capture.mjs` is staged into `output/hooks/` by every plugin build. This variant's
`hooks.json` registers no telemetry event. Do not write parity language on the strength of the shim
shipping.

### A shim failure is invisible by design

`session-preamble.mjs` degrades to a one-line "ambient awareness did not load" notice and exits 0. A
wrong path, a renamed subcommand, an unregistered event, or a missing `launcher.cjs` produces no
build error and no test failure.

## When a change here ripples

- **Changed `hooks.json`, or how `launcher.cjs` resolves a path?** Both are copied verbatim into
  `output/hooks/` at build time, so nothing changes until a rebuild — and unlike the Claude variant
  there is no source↔output parity suite here to notice a stale build. Detail:
  [`../AGENTS.md`](../AGENTS.md)

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
node --test harness-installers/copilot-cli-plugin/tests/bootstrap.test.mjs
node --test harness-installers/copilot-cli-plugin/tests/drift-check.test.mjs
npm test -w harness-installers/copilot-cli-plugin
```

**Never run `bootstrap.mjs` directly against your own home directory.** It writes into `~/.radorc/`,
stops a running dashboard, and rewrites a `hooks.json`. Use the suites, which inject a temp home, or
the `/rad-dogfood-plugin` skill.

## Further reading

- [`../../shared/hooks/AGENTS.md`](../../shared/hooks/AGENTS.md) — the shim this variant registers
  but does not own
- [`../lib/install/AGENTS.md`](../lib/install/AGENTS.md) — what `bootstrap.mjs` runs
- [`docs/internals/ambient-awareness.md`](../../../docs/internals/ambient-awareness.md) — the
  per-harness stdout contract the drift line and the preamble both obey
- [`../AGENTS.md`](../AGENTS.md) — this variant's deltas
