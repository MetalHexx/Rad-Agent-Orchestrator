# `harness-installers/shared/hooks/`

The single source for both hook shims that run **on the end user's machine**. Every installer variant
stages these same files into its own `hooks/` output; nothing re-implements them, and nothing
here knows which variant it was copied into.

> **What the preamble hook is for, and the per-harness stdout contract it satisfies, live in
> [`docs/internals/ambient-awareness.md`](../../../docs/internals/ambient-awareness.md).** Read it
> before changing what `serializeForStdout` emits or adding a harness branch. Not needed to fix a
> parse path or add a captured field.

## How it works

- `session-preamble.mjs` — runs the bundled CLI's `session-context` subcommand and returns the
  rendered ambient-awareness and communication-style block as `additionalContext`.
- `telemetry-capture.mjs` — reads a hook payload on stdin and spawns `radorch telemetry capture`.
- `tests/` — one `node:test` suite per shim.

Both shims resolve the CLI bundle the same way: from `CLAUDE_PLUGIN_ROOT` or
`COPILOT_PLUGIN_ROOT` when a plugin injected one, otherwise from this file's own location one level
up from `hooks/` — which is what makes the same file work under `~/.claude/` and `~/.copilot/`
without knowing which it is in.

**Registration is not owned here.** Each variant decides which events the shims are wired to, in its
own `hooks/hooks.json`; for the standard installer's Claude harness, the wiring is written into the
user's `settings.json` at install time. Copying a shim into a variant's output does not make it fire.

## Conventions

- **Node built-ins only.** No third-party imports, no YAML parser. `telemetry-capture.mjs` reads
  `orchestration.yml` with a line scanner that mirrors the CLI's own gate logic rather than parsing
  it. A dependency added here would have to exist on the user's machine, and nothing installs one.
- **Never throw, never block, never exit non-zero.** The preamble degrades to a one-line "ambient
  awareness did not load" notice on any failure; the capture shim swallows everything and forces
  `process.exit(0)` in a `finally`. Session start must not be delayed or broken by either.
- **Check the telemetry gate first.** `readTelemetryEnabled` runs before stdin is read and before
  anything is spawned. Absent, `false`, or an unreadable file all mean off.
- **Pure functions, injectable side effects.** `buildHookOutput` takes an injectable `run`; the
  parsers take their input as a string. Tests never spawn a real process.
- **The direct-run guard is deliberate, and both shims express the same condition.** The guarded
  block fires when `argv[1]` is the shim itself *or* is undefined (the plugin's
  `node -e "import(…)"` launch form), and stays inert when a test imports the module. The code
  differs: `telemetry-capture.mjs` compares URLs and calls a `main()`, `session-preamble.mjs`
  compares resolved paths and inlines the body. Do not simplify either to an
  `import.meta.main`-style check.
- **The sanctioned env vars are `CLAUDE_PLUGIN_ROOT`, `COPILOT_PLUGIN_ROOT`, and `COPILOT_CLI`.**
  Do not introduce another, and do not reference a destination path belonging to one variant.

### The harness discriminator is per-function, not global

`serializeForStdout` branches on **`COPILOT_CLI=1` alone** — Claude Code and Copilot in VS Code are
deliberately not told apart, because both set `CLAUDE_PLUGIN_ROOT` and `VSCODE_PID` is present
whenever Claude runs in a VS Code terminal. `parseSessionIdentity` uses a **wider** test: `COPILOT_CLI=1`
**or** `COPILOT_PLUGIN_ROOT` present without `CLAUDE_PLUGIN_ROOT`. Do not unify them on the
assumption that one discriminator serves the file.

## Hazards

### These suites run in no CI workflow

`tests/session-preamble.test.mjs` and `tests/telemetry-capture.test.mjs` are not wired into any job
in `.github/workflows/`, and no workspace `npm test` reaches them — `shared/` is not a package. A
change here can land fully green. Run them yourself:

```
node --test harness-installers/shared/hooks/tests/*.test.mjs
```

### A CLI rename fails here silently, on a user's machine

Both shims call `radorch` by exact subcommand string — `session-context` and `telemetry capture` —
and read fields out of the envelope's `data`. Nothing resolves those strings at build time. A rename
produces no build error, no test failure, and no visible runtime failure: the preamble prints its
"did not load" notice and exits 0, and the capture shim swallows the spawn result entirely.

### The `PostToolUse` telemetry entry carries no `matcher`

It fires on **every** tool, not only `Agent`, so main-agent spend is harvested mid-turn rather than
only at `Stop`. This was a deliberate broadening; the added per-tool fires are non-blocking because
the CLI detaches a background worker. Any doc or comment claiming `matcher: "Agent"` is stale.

### Copying a shim into a variant is not registering it

`telemetry-capture.mjs` is staged into every variant's `hooks/` output, but only the Claude channels
register it — the Claude plugin's `hooks.json` and, for the standard installer, the entries written
into `~/.claude/settings.json`. Neither Copilot variant's `hooks.json` wires it to any event. Do not
read "the shim ships everywhere" as "telemetry runs everywhere".

## When a change here ripples

- **Changed which subcommand a shim calls, or which envelope fields it reads?** The command surface
  belongs to `cli/`, and the failure is silent on a user's machine with no build error anywhere.
  `cli/AGENTS.md` already declares the edge in the other direction — keep both sides naming the same
  commands. Detail: [`cli/AGENTS.md`](../../../cli/AGENTS.md)

- **Changed `parseHookEvent`, `toCaptureArgs`, or what the capture shim spawns?** The argument list
  is the wire format into `radorch telemetry capture`, and the shim sits on the agent's critical
  path — anything that makes capture synchronous or slow is felt in every tool call of every
  session. Detail: [`lib/telemetry/AGENTS.md`](../../../lib/telemetry/AGENTS.md)

- **Changed `readTelemetryEnabled`'s parsing, or the config shape it depends on?** It hand-scans
  `~/.radorc/orchestration.yml` for `telemetry.enabled` rather than parsing YAML, so a change to how
  that section is nested or named turns the gate off for everyone with no error. The shipped file
  and the CLI's own reader must move with it. Detail:
  [`runtime-config/AGENTS.md`](../../../runtime-config/AGENTS.md)

- **Changed what a shim needs from its environment, or added a hook event?** Registration lives in
  each variant — every plugin's `hooks/hooks.json` and the standard installer's `settings.json` merge.
  A shim that expects a value nobody wires up fails silently by contract. Detail:
  [`../../standard/AGENTS.md`](../../standard/AGENTS.md), [`../../AGENTS.md`](../../AGENTS.md)

## Commands

```
node --test harness-installers/shared/hooks/tests/*.test.mjs
```

Changes here reach your own machine only through a build and a reinstall — run the
`/rad-dogfood-harness` skill. Nothing here is hot-reloaded.

## Further reading

- [`docs/internals/ambient-awareness.md`](../../../docs/internals/ambient-awareness.md) — what the
  preamble carries, the harness serialization contract, and the other `SessionStart` hook
- [`docs/internals/communication-style.md`](../../../docs/internals/communication-style.md) — the
  second block the preamble renders
- [`cli/AGENTS.md`](../../../cli/AGENTS.md) — the commands both shims call, and the envelope
- [`lib/telemetry/AGENTS.md`](../../../lib/telemetry/AGENTS.md) — what consumes the capture events
- [`../AGENTS.md`](../AGENTS.md) — why this folder is runtime and its sibling is build time
