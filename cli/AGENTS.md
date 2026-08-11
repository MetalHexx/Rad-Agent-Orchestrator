# `cli/` — Contributing Guide

## Purpose

This folder is the `radorch` CLI — a single Node/TypeScript binary that provides every user-facing helper invoked by the canonical skills. Subcommands live under noun groups (`radorch action-events ...`, `radorch config ...`, `radorch doctor ...`, `radorch execute ...`, `radorch gate ...`, `radorch graph ...`, `radorch migrate ...`, `radorch pipeline ...`, `radorch plan ...`, `radorch project ...`, `radorch project-group ...`, `radorch repo ...`, `radorch repo-group ...`, `radorch session-context ...`, `radorch side-project ...`, `radorch skill ...`, `radorch source-control ...`, `radorch telemetry ...`, `radorch ui ...`, `radorch worktree ...`). Every subcommand emits a single JSON envelope of the shape `{ ok, data, error }` on stdout, accepts the same UX flags (`--non-interactive`, `--json`, `--no-color`, `--log-level`), and routes through the same logger and prompter surface.

The CLI bundle is built once per harness by `emitCliBundle` in `harness-installers/shared/build-helpers/` and shipped to `${HARNESS_ROOT}/skills/rad-orchestration/scripts/radorch.mjs`. Skills invoke it via the `${PLUGIN_ROOT}` token, which expands at install time to the harness root.

## How it works

Layered structure:

- `cli/src/bin/radorch.ts` — process entry point. Reads argv, builds the commander program via `buildProgram`, and invokes it.
- `cli/src/cli.ts` — the commander program builder. Wires every top-level noun and delegates to per-subcommand modules.
- `cli/src/framework/` — framework primitives: `defineCommand`/`runCommand`, the envelope `emit`/`validateEnvelope` surface, the logger, prompter, theme, and exit-code map.
- `cli/src/commands/<noun>/` — one folder per noun. Each subcommand exports a `defineCommand({ ... })` value and a pure core function (test-injectable) that does the actual work. Existing nouns: `action-events`, `config`, `doctor`, `execute`, `gate`, `graph`, `migrate`, `pipeline`, `plan`, `project`, `project-group`, `repo`, `repo-group`, `session-context`, `side-project`, `skill`, `source-control`, `telemetry`, `ui`, `worktree`.
- `cli/src/lib/` — small, cross-command utilities (paths, install.json shape, fs helpers, yaml).
- `cli/tests/` — vitest suite. Mirrors the `src/` tree (`tests/commands/<noun>/<name>.test.ts`).

Every subcommand follows the same flow inside `runCommand`: commander parses argv → required-arg wizard fills missing args from stdin (when interactive) → handler runs → handler's return value is wrapped in the standard envelope → envelope is emitted via the single `console.log` site → process exits with the framework-default mapping (or an explicit `exit_code` override on success).

## Coding standards

- **Envelope on stdout is non-negotiable.** Every code path emits exactly one envelope via `framework/output.ts#emit`. No subcommand uses `console.log` directly; no path emits multiple JSON objects; no path emits a flat JSON object outside the envelope. The response payload lives inside `data`.
- **Default exit-code map.** `ok: true → 0`, `ok: false` with `user_error → 1`, `ok: false` with `system_error → 2`. Only `doctor` overrides via `mapResult` + `exit_code` to express "envelope is `ok: true` but findings exist; exit 1". Do not invent new exit codes for partial-success states — surface partial success through `data` fields.
- **Three-level help text.** Every noun group declares a one-line `description` on the `program.command(<noun>)` call. Every subcommand declares a present-tense action-verb `description` on its `defineCommand` (under 90 columns, no trailing period unless the description is two sentences). Every `--flag` declares its `description` field in the `ArgSpec` / `FlagSpec` shape — describe what the flag accepts and any defaults, not just restate the flag name. Verify by running the help at all three depths: `radorch --help`, `radorch <noun> --help`, `radorch <noun> <subcommand> --help`.
- **Test-injectable shell-out.** Subcommands that shell out (e.g., `radorch source-control init` runs `git` internally) export a pure core function (`sourceControlInit({ readWorktreeFacts, ... })`) that accepts injectable dependencies. The `defineCommand` handler is a thin shell around the core function. Unit tests pass stub implementations of those dependencies and never depend on the host having external binaries installed.
- **No new runtime dependencies without a strong reason.** The CLI is bundled into `radorch.mjs` by `esbuild`; every new entry in `cli/package.json#dependencies` grows the bundle. Prefer `node:*` builtins (`child_process`, `fs`, `path`, etc.) over npm packages.
- **No test-only methods in production code.** Test utilities live under `cli/tests/`. Dependency injection (the `exec` parameter pattern above) is how the test/production gap stays honest; do not add `if (process.env.NODE_ENV === 'test')` branches to skip work.
- **Registry writes go through the `@rad-orchestration/repo-registry` mutations only (hard rule).** A command must never import `writeIdentity` / `writeLocal` / `ensureLocalGitignored`, nor mutate `reg.repos` / `reg.repoGroups` / `reg.localPaths` and persist inline. Commands read (`readRegistry` / `resolveRepoPath`), do their domain work (git detection, validation, prompting), then call exactly one named mutation: `addRepo`, `editRepo`, `removeRepo`, `bindRepo`, `createGroup`, `editGroup`, `addGroupMember`, `removeGroupMember`, `deleteGroup`. This keeps the write surface reusable (the UI calls the same library) and the registry's invariants in one place. Enforced by `cli/tests/lib/registry-mutation-seam.test.ts`.

### Per-agent flag validation (worktree launch pattern)

When a subcommand's flag matrix depends on a discriminant flag value (e.g., `worktree launch --agent` selects which of `--prompt` and `--permission-mode` apply), validate compatibility synchronously in the handler before any side-effecting work. Export the validator as a pure function so it is independently unit-testable, returning either `{ ok: true, ...normalized fields }` or `{ ok: false, error }`. The handler invokes the validator first; on rejection it surfaces the standard envelope with `error.type` of `user_error` and a message naming the offending flag and the discriminant value that caused the conflict. Worked example: `validateLaunchFlags({ agent, prompt, permissionMode })` in `cli/src/commands/worktree/launch.ts`.

## Seams to other modules

- **`harness-files/skills/<name>/SKILL.md`** — canonical skill files invoke subcommands via `node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" <noun> <subcommand> ...`. The `${PLUGIN_ROOT}` token expands at install time to the harness root (`~/.claude/` or `~/.copilot/`). Always double-quote `${PLUGIN_ROOT}` at the call site to handle paths with spaces. A regression guard at `harness-files/tests/test-skill-call-form.test.mjs` enforces the canonical call form on every shipped `SKILL.md`.
- **`harness-installers/shared/build-helpers/emit-cli-bundle.js`** — bundles `cli/src/` into `radorch.mjs` via esbuild. Runs once per harness during the standard installer build (and again during each plugin build).
- **`harness-installers/standard/manifests/<harness>/v1.0.0-alpha.N.json`** — the standard installer's checked-in manifest. After any addition or deletion under `cli/src/`, the manifest must be regenerated via `npm run build` in `harness-installers/standard/` so the bundled `radorch.mjs` sha256 is current. Manifests are regenerated in place at the current alpha version; no version bump per iteration.
- **`cli/src/lib/pipeline-engine/`** — the pipeline engine, shared across multiple command surfaces. `commands/pipeline/signal.ts` is the primary consumer; `commands/gate/shared.ts` drives `processEvent` for both `gate approve-plan` and `gate approve-final`. New subcommands should not reach into the engine surface unless they are approving or progressing pipeline state.
- **`@rad-orchestration/repo-registry` (workspace package, by name)** — the CLI imports the registry library by package name, resolved through the npm workspace symlink at `node_modules/@rad-orchestration/repo-registry`. This is the only sanctioned seam for registry reads and writes. Deep relative imports that reach into `lib/repo-registry/src/` directly are retired and prohibited. The workspace symlink resolves against the library's compiled `dist/` output, so `npm run build -w @rad-orchestration/repo-registry` must run (or have already run) before bundling the CLI.

## Build output layout

`npm run build` (i.e., `tsc`) compiles `cli/src/` into `cli/dist/` with the following top-level layout:

```
dist/
  bin/
    radorch.js          ← process entry point (referenced by package.json "bin")
  cli.js
  commands/             ← one sub-folder per noun
  framework/
  lib/
```

The `radorch.mjs` single-file bundle (produced by `emit-cli-bundle` via esbuild) is the shipping artifact — it is NOT the same as `dist/bin/radorch.js`. The `dist/` tree is used locally (via `npm start` / `npm run build-and-start`) and during the standard-installer build to verify that the library's workspace package resolves before bundling. The bundle itself inlines all dependencies (including the repo-registry dist) into a single `.mjs` file shipped to `output/<harness>/skills/rad-orchestration/scripts/radorch.mjs`.

## Adding a new subcommand — worked walkthrough using `radorch source-control init`

1. **Pick the noun.** Group by user concept (the operation the user thinks they're doing), not by the implementation tool. `source-control` covers initialization of worktree source-control state; `git` is an implementation tool. Existing nouns: `action-events`, `config`, `doctor`, `execute`, `gate`, `graph`, `migrate`, `pipeline`, `plan`, `project`, `project-group`, `repo`, `repo-group`, `session-context`, `side-project`, `skill`, `source-control`, `telemetry`, `ui`, `worktree`. Reuse before you invent.

2. **Author the core function.** Create `cli/src/commands/<noun>/<name>.ts`. Export a pure function with injectable dependencies:
    ```ts
    export interface SourceControlInitOptions {
      project: string;
      readProjectRepos: (project: string) => { repos: string[] };
      readWorktreeFacts: (worktreePath: string, baseBranch: string) => WorktreeFacts;
      // ... other dependencies
    }
    export function sourceControlInit(opts: SourceControlInitOptions): SourceControlInitResult { ... }
    ```
   The core function returns the response shape; the framework wraps it in `data` automatically. No `console.log` inside the core function.

3. **Author the `defineCommand` shell.** In the same file, export a thin commander wrapper with a separate `*WithDefaults` variant that wires the real implementations:
    ```ts
    export const sourceControlInitCommand = defineCommand({
      name: 'source-control-init',
      description: 'Validate worktrees and record source-control state for a project',
      args: {
        project: { description: 'Project name; selects the master plan whose repos: list is validated', required: true },
      },
      flags: {
        'in-place': { description: 'Record a single in-place (main clone) binding for a single-repo project' },
      },
      handler: async ({ args, flags }) => sourceControlInitWithDefaults({
        project: args.project!,
        inPlace: flags['in-place'] ?? false,
      }),
    });
    ```
   Description style: present-tense action verb, under 90 columns, no trailing period. Each arg/flag description names what the flag accepts and any defaults.

4. **Re-export from the noun index.** Add `cli/src/commands/<noun>/index.ts`:
    ```ts
    export { sourceControlInitCommand, sourceControlInit, sourceControlInitWithDefaults } from './init.js';
    ```

5. **Wire into the commander program.** In `cli/src/cli.ts`, import the command and register it under the noun group (mirror the existing `source-control` block exactly):
    ```ts
    const sourceControl = program.command('source-control').description('Source-control lifecycle operations');
    sourceControl.command('init')
      .description(sourceControlInitCommand.description)
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments(true)
      .action(async () => {
        const argv = process.argv.slice(4);
        await runCommand(sourceControlInitCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
      });
    ```

6. **Add a tooling check (only if introducing a new external runtime dependency).** If the subcommand shells out to a binary the doctor's `Tooling` category does not already probe, extend `cli/src/commands/doctor/checks.ts#runToolingChecks` with a probe (presence + any version/auth precheck). Use the existing injectable dependency pattern so the unit test is deterministic. Existing probes: `git`, `gh`.

7. **Test the core function.** Create `cli/tests/commands/<noun>/<name>.test.ts`. Use vitest's `vi.fn()` to stub the injected dependencies. Cover every documented outcome the subcommand can produce. Do not shell out to real binaries in unit tests.

8. **Test the help shape.** Extend `cli/tests/bin/help.test.ts` with assertions that the new subcommand surfaces at all three help depths. The test compiles via `npx tsc` and runs `node dist/cli/src/bin/radorch.js --help` (and the deeper levels).

9. **Rewrite the calling skill.** If a SKILL.md was the previous caller, rewrite its invocation to:
    ```
    node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" <noun> <subcommand> ...
    ```
   Read result fields from inside the envelope's `data` block (e.g., `data.projectDir`). The regression guard at `harness-files/tests/test-skill-call-form.test.mjs` catches malformed rewrites (wrong token, wrong path, missing/malformed subcommand chain, unquoted `${PLUGIN_ROOT}`).

10. **Regenerate manifests.** After any file added or deleted under `cli/src/` or `harness-files/skills/`, run `cd harness-installers/standard && npm run build` to refresh the three checked-in `v1.0.0-alpha.N.json` manifests in place. Commit the manifest diff alongside the code change in the same PR (no coexistence window — the manifest snapshot must reflect the source tree at every commit on `main`).

## Further reading

- `harness-files/AGENTS.md` — the canonical-skills source-of-truth folder; documents the `${PLUGIN_ROOT}` and `${SKILLS_ROOT}` token contracts.
- `harness-installers/AGENTS.md` — installer-variant organization; covers how `emitCliBundle` ships the CLI bundle into each harness.
- `harness-installers/standard/AGENTS.md` — the standard installer's build pipeline, where the manifest regeneration step lives.
