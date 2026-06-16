# shared/hooks/

## Purpose

Single source for the preamble hook shim shared across all installer variants.
Code here is installer-agnostic — it carries no harness-specific names, paths,
or config values.

## Contents

- `session-preamble.mjs` — the preamble hook shim. See below.
- `telemetry-capture.mjs` — the telemetry capture hook shim. See below.
- `tests/session-preamble.test.mjs` — Node built-in test runner suite for the preamble shim.
- `tests/telemetry-capture.test.mjs` — Node built-in test runner suite for the telemetry capture shim.

## session-preamble.mjs — preamble hook shim

Exports a single pure function `buildHookOutput({ run? })`. Called by the
harness session-start hook entry point in each installer variant.

### What it does

1. Runs the bundled CLI's `session-context` subcommand (injectable via `run`).
2. Parses the canonical envelope `{ ok, data, error }` from stdout.
3. Returns `{ additionalContext }`:
   - **ok:true** → `data.preamble` text is surfaced as `additionalContext`.
   - **ok:false, non-zero status, or unparseable stdout** → a clear one-line
     notice that ambient awareness did not load (including the error message
     when present). The hook never fails silently and never throws.

### Harness context-channel contract

The `additionalContext` key is the cross-harness context-channel:

| Harness | Hook event | Context key |
|---|---|---|
| Claude Code | `SessionStart` | `additionalContext` |
| Copilot (VS Code plugin) | session hook | `additionalContext` |
| Copilot CLI plugin | session hook | `additionalContext` / `hookSpecificOutput` |

### Dual radorch.mjs resolution (AD-10)

The shim resolves the bundled CLI two ways:

1. **Plugin delivery** — `CLAUDE_PLUGIN_ROOT` (Claude / Copilot-VSCode) or `COPILOT_PLUGIN_ROOT` (Copilot CLI) is set; radorch path:
   `${CLAUDE_PLUGIN_ROOT|COPILOT_PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs`
2. **Standard delivery** — both env vars are absent; radorch path is derived relative to this hook file's location (harnessRoot = directory one level up from `hooks/`):
   `<harnessRoot>/skills/rad-orchestration/scripts/radorch.mjs`
   This allows the same hook to work under any harness root (e.g., `~/.claude/`, `~/.copilot/`).

Any spawn failure resolves to the notice path — the hook never blocks or
delays session start.

## telemetry-capture.mjs — telemetry hook shim

Installed by every harness variant. Invoked by Claude's hook runtime on `PostToolUse` (matcher `Agent`), `Stop`, and `SessionEnd` events (the three-event telemetry set). Single-source here (AD-8); each installer copies it into its own `hooks/` directory at build time.

### Built-ins only

Uses only Node built-in modules (`node:child_process`, `node:fs`, `node:os`, `node:path`, `node:url`). No third-party dependencies, no YAML parser (AD-4, NFR-2).

### Startup contract

1. **Gate checked first (default-off, AD-4/AD-5)** — reads `~/.radorc/orchestration.yml` using a built-in-only line scanner that mirrors the CLI's `readTelemetryEnabled` logic. If `telemetry.enabled` is absent, `false`, or the file is missing, the shim exits immediately with code 0. No further work is done.
2. **stdin read** — reads the full hook payload from stdin (fd 0) as UTF-8. Failures silently default to an empty string.
3. **Event parsing (`parseHookEvent`)** — parses the JSON payload into a structured event object. snake_case fields are preferred (`hook_event_name`, `session_id`, `cwd`, `transcript_path`, `tool_name`, `agent_transcript_path`, `agent_id`, `agent_type`, `tool_use_id`); camelCase aliases are accepted for `hookEventName`. Nested `tool_response` fields (`agent_id`, `agent_type`, `agent_transcript_path`, `tool_use_id`) are read from `tool_response.*` when the top-level field is absent. Unknown `hook_event_name` values normalize to `Stop`.
4. **CLI args built (`toCaptureArgs`)** — builds the `telemetry capture --event <name> [--session …] [--cwd …] …` argument list from the parsed event. Each flag is only appended when the corresponding value is non-empty.
5. **Synchronous spawn** — runs `radorch.mjs telemetry capture …` via `spawnSync` with a hard 10 000 ms `SIGKILL` timeout (AD-6). `stdio: 'ignore'`. Failures are caught and swallowed.
6. **Always exit 0** — the `finally { process.exit(0) }` block ensures the shim never returns non-zero regardless of capture success or failure (NFR-1).

### radorch.mjs resolution

Same dual-resolution strategy as `session-preamble.mjs` (AD-10):

1. **Plugin delivery** — `CLAUDE_PLUGIN_ROOT` or `COPILOT_PLUGIN_ROOT` is set → `${ROOT}/skills/rad-orchestration/scripts/radorch.mjs`
2. **Standard delivery** — both vars absent → one level up from `hooks/` → `<harnessRoot>/skills/rad-orchestration/scripts/radorch.mjs`

### Direct-run guard

The shim's `main()` runs when launched directly (`node telemetry-capture.mjs` → `argv[1]` is the shim) or via the plugin's `node -e "import(…)"` form (where `argv[1]` is `undefined`). When imported by tests, `argv[1]` is the test file path, so the guard is false and `main()` stays inert. This mirrors `session-preamble.mjs`.

### Exported symbols (for testing)

- `readTelemetryEnabled(root: string): boolean` — reads `orchestration.yml` in `root`; default-off.
- `parseHookEvent(stdin: string): EventObject` — parses raw stdin JSON to a structured event.
- `toCaptureArgs(evt: EventObject): string[]` — builds the `radorch` CLI argument list.

## Coding conventions

- `buildHookOutput` is a pure function; all inputs flow through parameters.
- No global state; no side effects outside what `run` performs.
- `run` defaults to `spawnSync`; tests inject a synchronous stub.

## Rules for making updates

- This directory is the single source for both the preamble shim (`session-preamble.mjs`) and the telemetry capture shim (`telemetry-capture.mjs`). Do not duplicate either inside individual installer variant trees.
- Installer-specific hook entry points (in each `harness-installers/<variant>/hooks/`)
  import or bundle these shims; they do not re-implement them.
- Any change to the `buildHookOutput` signature is a breaking change for all
  callers. Locate every import before modifying the signature.
- Any change to `parseHookEvent`, `toCaptureArgs`, or `readTelemetryEnabled` must be reflected in `tests/telemetry-capture.test.mjs` and may require updating `harness-installers/standard/AGENTS.md` and `harness-installers/claude-plugin/AGENTS.md` if the documented behavior changes.
- Do not reference installer names, harness-specific destination paths that belong
  to a single installer variant, or unsanctioned env vars. The sanctioned harness-specific env vars for plugin path delivery are:
  - `CLAUDE_PLUGIN_ROOT` (Claude Code / Copilot-VSCode harnesses)
  - `COPILOT_PLUGIN_ROOT` (Copilot CLI harness)
