# Standard Installer Package

## Purpose

This folder is a self-contained npm package that produces the publishable `rad-orchestration` tarball distributed to end users via `npx rad-orchestration`. The binary is `rad-orchestration` (matches the package name so `npx rad-orchestration` resolves under npm exec's name-match path). Contributors landing here are authoring the end-user installation experience that copies greenfield bundles to user-level harness folders (`~/.claude/`, `~/.copilot/`), generates `orchestration.yml`, and optionally sets up the dashboard.

## How it works

**Build stage** (`build-scripts/build.js`): Runs adapters over canonical sources (`harness-files/agents/`, `harness-files/skills/`) and emits per-harness bundles to `output/` (gitignored). The `npm pack` step operates from the `output/` directory, bundling the built artifacts into the tarball.

**User-facing wizard** (`lib/wizard.js`): Interactive CLI entry point whose only required output is harness selection — one or more InstallKey values plus a small set of configuration paths (AD-18). Planning-tier templates, gate behavior, and auto-commit settings are NOT collected by the wizard; they come from `runtime-config/orchestration.yml` shipping verbatim. There is no `lib/config-generator.js`.

**Per-harness install state machine** (`lib/install/`): Isolated install flow for each harness (Claude, Copilot in VS Code, Copilot CLI). Each state machine owns its own file write logic, symlink/copy decisions, and integration points with the chosen harness. The state machine ensures atomic, idempotent writes.

**Runtime user-data locations**: The installer populates `~/.radorc/` with `orchestration.yml` and `templates/`, and populates `~/.claude/` and `~/.copilot/` with agents, skills, and marketplace plugin bundles (where applicable per harness).

## Coding standards

- **ESM only**: All source code is authored as ES modules (`.mjs` in tests per Node 18+ `node --test` runner; `.js` elsewhere where context is clear).
- **Node 18+**: No backports; features like `fs.constants.copyFile` and top-level `await` are assumed available.
- **Atomic writes**: All user-data mutations use temporary files + rename pattern to avoid partial writes or corruption on interruption (NFR-3). If a write fails, no partial state is left behind.
- **Graceful error handling**: Post-install warnings (e.g., missing environment variables, dashboard setup hints) are caught and swallowed per NFR-4; they never halt the installer or return non-zero exit codes. User sees warnings, flow continues.
- **No test-only code in production**: Test utilities and mock factories live only in `tests/` and never leak into `lib/`.

## Telemetry hook wiring (FR-14)

The standard installer wires telemetry capture hooks into Claude's `settings.json` at install time and removes them at uninstall time. This is done exclusively for the `claude` harness; Copilot harnesses deliver the shim via the manifest and do not need settings.json injection.

### Functions (lib/install/claude-hook-settings.js)

- **`reconcileTelemetryHooks({ settingsPath, hookCommand })`** — Adds or refreshes the three telemetry hook entries (`PostToolUse`, `Stop`, `SessionEnd`) tagged with the stable marker `rad-orc-telemetry`. Each entry embeds `hookCommand` verbatim with the marker as a comment suffix (`# rad-orc-telemetry`). The `PostToolUse` entry carries `"matcher": "Agent"` so it fires only on `Agent`-type tool calls (AD-7). Idempotent: re-running leaves the settings file unchanged when commands are identical. Self-healing: if any of the three events is missing or has an outdated command, it is added or replaced in-place — partial installs heal to the full three-event set (NFR-5). Atomic write via temp+rename (NFR-2). Never touches the preamble (`SessionStart`) or any other hook entry (NFR-3).

- **`removeTelemetryHooks({ settingsPath })`** — Filters out exactly the `rad-orc-telemetry`-marked entries from `PostToolUse`, `Stop`, and `SessionEnd`. Deletes the event array entirely when it held only the telemetry entry. Leaves `SessionStart` (preamble) and all other hook entries untouched (NFR-3). Atomic write via temp+rename.

### Three-event set

| Hook event | `matcher` | Purpose |
|---|---|---|
| `PostToolUse` | `Agent` | Captures sub-agent tool-use completions (incl. `tool_response` fields) |
| `Stop` | _(none)_ | Captures session stop events |
| `SessionEnd` | _(none)_ | Captures session end events |

### Marker

The string `rad-orc-telemetry` is embedded in the `command` field of every telemetry hook entry (as `# rad-orc-telemetry` suffix). This allows idempotency checks and removal to locate entries without any extra metadata field. It is distinct from the preamble marker `rad-orc-preamble` (AD-7).

### Hook shim — telemetry-capture.mjs

The `copy-hook-shim` build step copies `harness-installers/shared/hooks/telemetry-capture.mjs` into each per-harness `output/<harness>/hooks/` tree alongside `session-preamble.mjs`. Both shims share a single source under `shared/hooks/` (AD-8). At install time `reconcileTelemetryHooks` points `hookCommand` at `~/.claude/hooks/telemetry-capture.mjs` (the manifest-dropped absolute location).

### `telemetry/` sacred-folder skip

`remove-files.js` declares `~/.radorc/telemetry/` as a sacred path. Any manifest entry whose resolved destination falls under `telemetry/` is skipped unconditionally during uninstall (logged to console as `[remove] skipping telemetry/ entry '<bundlePath>'`). This mirrors the `projects/` skip and ensures user-captured telemetry data survives uninstall and reinstall. The path is exposed via `userDataPaths().telemetry` (`lib/install/user-data-paths.js`).

## Seams to other modules

**Inputs (read at build and runtime)**:
- **`harness-adapters/output/<harness>/`** — Per-harness adapted agents, skills, and marketplace plugin definitions. The installer consumes these pre-built bundles and copies them into user-level locations. Adapters run once at build time (not at install time), so the installer always works offline.
- **`runtime-config/`** — `orchestration.yml` template and the four review-intensity tier templates (`extra-high.yml`, `high.yml`, `medium.yml`, `low.yml`). `orchestration.yml` is copied to `~/.radorc/orchestration.yml` only on fresh install (FR-14) — present files are preserved untouched so user edits survive upgrades. The four shipped tier templates always overwrite their counterparts under `~/.radorc/templates/` on every install (FR-15); any user-added templates in that folder are preserved.
- **`cli/`** — CLI parsing and launch surface (separate from the installer wizard proper). The installer is invoked by the `rad-orchestration` binary, which delegates to the wizard.
- **`ui/`** — Pre-compiled dashboard bundle (if included). Conditionally installed based on user choice in the wizard.
- **`cli/src/`** — The pipeline runtime and every other helper subcommand. `emit-cli-bundle` bundles `cli/src/` into `radorch.mjs` and ships it to `${HARNESS_ROOT}/skills/rad-orchestration/scripts/`; skills invoke the pipeline as `radorch pipeline signal`.
- **`harness-installers/shared/hooks/telemetry-capture.mjs`** — Single-source telemetry hook shim (AD-8). Copied into each per-harness `output/<harness>/hooks/` by the `copy-hook-shim` build step.

**Build-time helpers (no runtime imports)**:
- **`shared/build-helpers/`** — Manifest-driven file installation utilities used during the build stage to deploy adapted files to `output/`. Note: `emit-hook-bundle` exists in shared helpers but is unused here (AD-8); it is reserved for marketplace plugin builders and does not apply to the standard installer.

**Outputs (written at install time)**:
- **`~/.claude/agents/`** — Claude Code agents (if Claude harness chosen).
- **`~/.claude/skills/`** — Claude Code skills (if Claude harness chosen).
- **`~/.claude/plugins/`** — Marketplace plugin manifests and offline hooks cache (if applicable).
- **`~/.claude/hooks/telemetry-capture.mjs`** — Telemetry hook shim (Claude harness only); wired into `settings.json` by `reconcileTelemetryHooks`.
- **`~/.copilot/agents/`** — Copilot VS Code / CLI agents (if Copilot harness chosen).
- **`~/.copilot/skills/`** — Copilot skills (if Copilot harness chosen).
- **`~/.radorc/orchestration.yml`** — System configuration (user-owned; preserved on reinstall).
- **`~/.radorc/templates/`** — Review-intensity tier templates (refreshed on each install to pick up upstream improvements).
- **`~/.radorc/ui/`** — Dashboard code (if user opted in).
