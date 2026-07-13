# Repo Rules

These rules govern every contributor and every agent working in the orchestration system repo. They are absolute — read them before editing, building, or invoking anything.

## Canonical Source
- The [harness-files/skills](./harness-files/skills/) folder is canonical source.
- The [harness-files/agents](./harness-files/agents/) folder is canonical source.
- The [.claude](./.claude/) tree is runtime compiled for testing.
- The [.github](./.github/) tree is runtime compiled for testing.

## Never EXECUTE the pipeline from the Canonical source!
- When invoking the orchestration pipeline to execute a project, never read or invoke the files from the canonical source.
- Never read or invoke skills from the canonical source.
- Never read or invoke agents from the canonical source.
- The canonical source is uncompiled; running the pipeline from there bypasses the harness's resolved install root and produces incorrect path resolution for non-Claude harnesses.

## Only EDIT the Canonical Source!
- When making code changes to improve the Rad Orchestration system, only edit the canonical source!
- Editing files in the runtime compiled test trees is incorrect!

## DO NOT Add Requirements in Canonical Source
- When making changes to the rad orchestration pipeline and markdown files, do not leave requirements (FR-N, NFR-N, AD-N, DD-N) in the files. These should only be used in project planning documents, not actual code or documentation. The only exception is that we're making changes to the rad-create-plans or rad-code-review skills (under `harness-files/skills/`) which leverage requirements as part of project planning and code review.

## DO NOT Write Markdown-Shape Tests Without Explicit Instruction
- Do not author tests that assert on the textual shape of markdown files — regex `assert.match` / `expect().toContain` against headings, prose, pinned numbers in tables, or specific phrasing.
- These tests are brittle: every prose edit risks breaking them, and they pin the docs without testing code behavior.
- Broad anti-regression scans (one forbidden token swept across many `.md` files at once) are the exception; pinned-shape checks on individual docs are not.
- If a markdown invariant genuinely needs guarding, ask the user before adding the test.

## Codeblock Fences
When writing markdown documents in this repo, default to plain fences (no language tag) for shell commands. Most repo examples (`node`, `git`, `npm`, `gh`) are shell-agnostic — adding a `bash` or `powershell` tag primes agents on Windows toward the wrong shell. Only tag the fence when the snippet actually uses shell-specific syntax (`$env:VAR`, heredocs, `Test-Path`).

Do:
```
node example/build.js
```

Don't:
```bash
node example/build.js
```

## Per-module ownership
- Every module folder (`harness-files/`, `harness-adapters/`, each `harness-installers/<variant>/`, `runtime-config/`, `cli/`, `ui/`, `lib/repo-registry/`) owns its own code, tests, and `AGENTS.md`.
- Cross-module reach-ins are forbidden. A module does not `require`, import, or read another module's internal files directly.
- Cross-module sharing happens only through documented seams — the canonical example is `harness-installers/shared/build-helpers/`, which every installer variant consumes as a published-seam package.
- Read the target module's `AGENTS.md` before touching it; it carries that module's local conventions, build commands, and seam contract.

## Sanctioned cross-package consumption seam: `@rad-orchestration/repo-registry`

The npm workspace package `@rad-orchestration/repo-registry` (at `lib/repo-registry/`) is the sanctioned seam for registry reads and writes. It is consumed by name by both the CLI (`cli/`) and the UI's server-side API routes (`ui/app/api/**`). npm workspaces establish a symlink at `node_modules/@rad-orchestration/repo-registry` pointing to `lib/repo-registry/`; consumers resolve against the package's compiled `dist/` (ESM + `.d.ts`), not raw source.

Rules:
- Import this library by name (`@rad-orchestration/repo-registry`) only. Deep relative imports that point into `lib/repo-registry/src/` from another module are prohibited.
- The library's `dist/` must be compiled before any step that bundles the CLI or builds the UI. The standard-installer build (`node harness-installers/standard/build-scripts/build.js`) runs `npm run build -w @rad-orchestration/repo-registry` automatically as the `build-lib-dist` step before `emit-cli-bundle` and `emit-ui-bundle`.

## Workspace versioning

All `@rad-orchestration/*` scoped packages version in lockstep. When any one of them receives a version bump, every other package in the set must receive the same bump in the same commit. The governed set is:

- `@rad-orchestration/repo-registry` (`lib/repo-registry/`)
- `@rad-orchestration/work-graph` (`lib/work-graph/`)
- `@rad-orchestration/telemetry` (`lib/telemetry/`)
- `@rad-orchestration/cli` (`cli/`)

**Deliberate in/out call on unscoped workspaces:**

- `harness-adapters/engine` — **out**. This is an internal adapter seam, not a consumer-facing library, and does not participate in the lockstep version set.
- `harness-installers/` workspaces (e.g., `harness-installers/standard/`, `harness-installers/claude-plugin/`, `harness-installers/copilot-cli-plugin/`) — **out**. These are release-channel deliverables with independent versioning driven by marketplace publish cycles.

These in/out decisions are deliberate; revisit them explicitly if an unscoped workspace gains a cross-package contract.

## Build and test validation gates

Four installer/plugin builds and a standalone-trace gate remain enforced manually/locally. Run them in order from the repo root after a root `npm install`:

```
node harness-installers/standard/build-scripts/build.js
node harness-installers/claude-plugin/build-scripts/build.js
node harness-installers/copilot-cli-plugin/build-scripts/build.js
node harness-installers/copilot-vscode-plugin/build-scripts/build.js
```

Each must exit 0. The standard build produces its CLI esbuild output and the UI Next standalone; the plugin builders each produce their own CLI bundle. Automated enforcement is provided at the unit level by the CI lib job (which runs `lib/repo-registry` tests); the full installer builds are manual/local gates run before landing changes that touch `lib/repo-registry`, `cli/`, `ui/`, or the shared build-helpers.

## Reserved Namespace: rad-*

Skills shipped by the orchestration system carry the `rad-` prefix on both folder name and frontmatter `name`. The prefix is a **documentation-only reserved namespace** — the system does not hard-enforce uniqueness against downstream authors, but the planner-spawn manifest filter (the `radorch skill list` subcommand and its shared `buildSkillManifest` module) deliberately excludes any `rad-*` skill from the manifest. Authoring a `rad-something` skill in your own repo will therefore make it invisible to the planner.

See `.agents/skills/rad-create-skill/SKILL.md` for the matching authoring convention.

## Source Layout

Canonical agent and skill source lives under `harness-files/` (at `harness-files/agents/` and `harness-files/skills/`), authored in Claude shape — the format Claude Code reads natively. Nothing is generated *at the repo root* by the build — `npm run build` stages adapter output under `dist/staging/<harness>/` and then deploys it to the harness's user-level location (`~/.claude/` or `~/.copilot/`) via the same manifest-driven library every installer uses. Edit the canonical source; never edit the deployed output.

The rest of the repo splits by job:

- **`harness-adapters/`** — self-contained per-harness adapters (one folder per harness; see that folder's `AGENTS.md`).
- **`harness-installers/<variant>/`** — one installer per shippable variant (`standard`, `claude-plugin`, `copilot-cli-plugin`), plus a `shared/` seam consumed by all of them. The `standard` build is also the repo-root `npm run build`, and the `/rad-dogfood-harness` dev loop reinstalls through it.
- **`runtime-config/`** — `orchestration.yml` and tier templates shipped verbatim by every installer into the user's `~/.radorc/`.
- **`cli/`, `ui/`, `docs/`, `prompt-tests/`, `.agents/`, `.githooks/`, `.github/`** — unchanged contributors to the system; see their own folders.

The `rad-*` reserved-namespace rule above applies to `harness-files/skills/` — it does not change with the restructure.

# Common Commands

## Multi-harness build (repo root)

`npm run build` runs the standard installer build (`node harness-installers/standard/build-scripts/build.js`), which projects the canonical `harness-files/` agents and skills through every adapter into `harness-installers/standard/output/<harness>/` and emits the per-harness manifests. It builds all three harnesses (`claude`, `copilot-vscode`, `copilot-cli`) in one pass and does **not** deploy anything to your user-level `~/.claude/` or `~/.copilot/`.

```
npm run build   # build standard installer output for all harnesses (no deploy)
```

## Deploying canonical edits to your machine (dogfood loop)

After editing any file under `harness-files/`, get it onto your machine by **reinstalling through the standard installer** — this is the only path that expands the `${PLUGIN_ROOT}` content token to a concrete harness root, so installed skills reference an absolute `radorch.mjs` instead of a literal token that breaks command resolution. (A plain file-copy would leave the token unexpanded — a real bug this path avoids.)

Run the `/rad-dogfood-harness` skill (`.claude/skills/rad-dogfood-harness/`). It builds and packs the `rad-orc` tarball, stops the UI, uninstalls the chosen harness, reinstalls it (expanding tokens), and restarts the UI. Pick one harness per run.

**First clone of the repo requires a redeploy** before the in-repo Claude Code instance can read up-to-date canonical content from `~/.claude/`. Note that `~/.claude/` is shared across all worktrees of this repo and across all Claude Code projects — only one branch's content can be active at a time. Switch worktrees → redeploy to swap.

**Be aware:** the system agents shipped from `harness-files/agents/` have bare names (no `rad-` prefix). If you have personal agents at `~/.claude/agents/` sharing those filenames, a reinstall will overwrite them. The installer's uninstall is manifest-scoped — it removes only the files the prior install recorded, so non-rad files outside the manifest are untouched.

## Tests by sub-package

**Build workspace libraries before running any test or typecheck command.** The libraries ship compiled `dist/` output that `tsc` and Vitest resolve at type-check and test time; without this step a fresh checkout with no committed `dist/` will fail. Run from the repo root first:

```
npm run build -w @rad-orchestration/repo-registry -w @rad-orchestration/work-graph -w @rad-orchestration/telemetry
```

This repo is a polyglot monorepo with several test runners. Pick the right one:

- **Root workspace/integration guards** (`tests/`) — Node's built-in test runner. Run from repo root:
  ```
  node --test tests/*.test.mjs
  ```
  Covers by-name resolution of `@rad-orchestration/repo-registry`, npm workspace linkage, and CI workflow wiring. These also run as part of the `repo-registry` CI job.
- **CLI bundle and pipeline engine** (`cli/`) — Vitest:
  ```
  cd cli && npm test                              # full suite
  cd cli && npx vitest run path/to/file.test.ts   # single file
  cd cli && npm run typecheck                     # tsc --noEmit
  cd cli && npx eslint .                          # lint
  ```
- **Telemetry library** (`lib/telemetry/`) — Vitest:
  ```
  cd lib/telemetry && npm test
  ```
- **Adapters** (`harness-adapters/`) — Node's built-in test runner. Run from repo root:
  ```
  node --test harness-adapters/**/*.test.js
  ```
- **Installer** (`harness-installers/standard/`) — Node test runner:
  ```
  cd harness-installers/standard && npm test
  ```
  The marketplace plugin builders (`harness-installers/claude-plugin/` and `harness-installers/copilot-cli-plugin/`) each carry their own test suite runnable the same way: `cd harness-installers/<variant> && npm test`.
- **Dashboard UI** (`ui/`) — Node test runner via tsx, plus `next` for dev/build:
  ```
  cd ui && npm test
  cd ui && npm run dev               # dev server (port 3000 — kill any prior occupant first)
  cd ui && npm run dev:live          # dev server + RADORCH_CLI_PATH wired + auto-builds the @rad-orchestration/* lib dist
  cd ui && npm run dev:live:watch    # dev:live, plus rebuild a lib + restart next dev on lib/*/src changes
  cd ui && npm run build-and-start   # full production build + start
  ```
  Use `dev:live` to develop against a live UI with hot reload; it needs the CLI built (`cd cli && npm run build`). It rebuilds the UI's `@rad-orchestration/*` lib `dist/` on startup, so a lib source change that wasn't compiled no longer serves stale data through the dev server (Fast Refresh doesn't watch that external `dist`); `dev:live:watch` keeps it fresh on every lib edit, and `--skip-libs` opts out of the startup build. The `/rad-ui-dev` skill wraps this. See `ui/AGENTS.md` for the full UI module guide.

## Prompt harnesses

`prompt-tests/` is an operator-driven, on-demand regression harness for planner subagent outputs. It is **not** part of CI and costs real Opus tokens per run — re-run only when a planner prompt, skill workflow, or explosion-script change actually warrants a new baseline. See `prompt-tests/README.md` for the per-behavior runner protocol.

# Architecture

The repo ships a document-driven, multi-agent orchestration system plus everything needed to develop it across multiple AI coding harnesses.

## Three execution layers

1. **Agents and skills** (markdown) — the orchestration product itself. Five specialized agents (under `harness-files/agents/`) and ~18 reusable skills (under `harness-files/skills/`) communicate exclusively through structured markdown documents. There is no shared memory or message passing between agents — every interaction is mediated by a document on disk. Each document type has exactly one writer (sole-writer policy). The Coder reads only its self-contained Task Handoff.
2. **Pipeline runtime** (TypeScript) at `cli/src/lib/pipeline-engine/`, exposed to skills as the `radorch pipeline signal` subcommand — a deterministic state machine. The main agent never makes routing decisions itself: it signals an event, parses the canonical envelope `{ ok, data, error }` from stdout, and dispatches on `data.action` against a fixed routing table. Routing, triage, and state validation are pure functions; LLM judgment is reserved for planning, coding, and review.
3. **Dashboard** (Next.js) at `ui/` — a read-only visualizer that watches each project's `state.json` and renders pipeline progress, documents, and configuration in real time.

## Multi-harness adapters

The system targets multiple AI coding harnesses (Claude Code, GitHub Copilot in VS Code, GitHub Copilot CLI) from a single canonical source.

- `harness-files/` is the **only** authored source — agents and skills written in Claude shape, which is also the format Claude Code reads natively.
- `harness-adapters/<harness>/adapter.js` is a self-contained per-harness projection: filename rule, frontmatter shape, tool-name dictionary, and model alias map. Adapters never transform the body of agents or skills, never modify `rad-*` skill names, and never ship settings or top-level instruction files.
- The standard installer build (`harness-installers/standard/build-scripts/build.js`, also `npm run build`) discovers adapters, runs them into `harness-installers/standard/output/<harness>/`, and emits per-harness manifests. Deploying that output to user-level (`~/.claude/`, `~/.copilot/`) happens through the installer's install flow — see the `/rad-dogfood-harness` dev loop.
- Publish-time bundles that ship to end users are the deliverable of a follow-on iteration and are out of scope for this document.
- A new harness is added by mirroring the template adapter under `harness-adapters/` (an empty scaffold with its own README and tests).

## Pipeline runtime detail

The pipeline runtime is the load-bearing piece. It lives at `cli/src/lib/pipeline-engine/`
and is invoked by skills via `radorch pipeline signal`. The engine emits the canonical
envelope `{ ok, data, error }`; the orchestrator dispatches on `data.action`. The
action routing table at `harness-files/skills/rad-orchestration/references/action-event-reference.md`
(16 actions) is the contract; the schema at
`cli/src/lib/pipeline-engine/schemas/orchestration-state-v5.schema.json` validates
every write.

## Installer

The repo ships three installer variants, each living under `harness-installers/`:

- `harness-installers/standard/` — the `rad-orchestration` npm package end users `npx rad-orchestration` to install. It walks an interactive wizard, generates `orchestration.yml`, and optionally sets up the dashboard.
- `harness-installers/claude-plugin/` — Claude marketplace plugin builder; produces a plugin tree the user installs through Claude Code's `/plugin` flow.
- `harness-installers/copilot-cli-plugin/` — Copilot CLI marketplace plugin builder; produces a plugin tree the user installs through Copilot CLI's `/plugin` flow.

All three consume `harness-installers/shared/build-helpers/` as the cross-variant seam, and all three ship `runtime-config/orchestration.yml` and `runtime-config/templates/` verbatim into the user's `~/.radorc/`. None of the installers ships settings files or top-level instruction files — those are user-owned.

## Skill and agent loading

The canonical sources at `harness-files/agents/` and `harness-files/skills/` are **not** what Claude Code loads at runtime — Claude Code reads from `~/.claude/agents/` and `~/.claude/skills/` (user-level, shared across all projects and worktrees on your machine). The `/rad-dogfood-harness` skill populates those paths by building the standard installer and reinstalling the harness, which runs the installer's `installManifestFiles` library — expanding `${PLUGIN_ROOT}` to the concrete harness root — to deploy. The same pattern applies to Copilot (`~/.copilot/`). After editing any agent or skill, redeploy before invoking it from the harness, otherwise the harness reads stale user-level content. When we edit project skills and agents, we are editing the canonical source at `harness-files/` — never edit the deployed output and expect those changes to survive a redeploy.

## Where things live

- `harness-files/` — canonical agent and skill source (committed)
- `harness-adapters/<harness>/` — self-contained per-harness adapter (committed)
- `harness-installers/standard/` — `rad-orc` npm installer package source; its build is repo-root `npm run build` and the `/rad-dogfood-harness` dev loop (committed)
- `harness-installers/claude-plugin/` — Claude marketplace plugin source (committed)
- `harness-installers/copilot-cli-plugin/` — Copilot CLI marketplace plugin source (committed)
- `harness-installers/shared/build-helpers/` — installer-blind build helpers shared by every installer variant (committed)
- `runtime-config/` — `orchestration.yml` and `templates/` shipped verbatim into installer outputs (committed)
- `cli/` — CLI bundle source (committed)
- `ui/` — Next.js dashboard (committed)
- `prompt-tests/` — operator-driven planner regression harness (committed)
- `harness-files/tests/` — repo-wide cross-cutting tests (e.g., reserved-namespace, agent-skill ref integrity) (committed)
- `tests/` — root-level workspace/integration guard tests: by-name resolution of `@rad-orchestration/repo-registry`, npm workspace linkage, and CI workflow wiring assertions (committed)
- `docs/` — user-facing docs; `docs/internals/` for refactor design notes (committed)
- `.agents/` — non-production / dev-only skills and prompts (e.g., `rad-create-skill` scaffolding) (committed)
- `.githooks/`, `.github/` — git and CI configuration (committed)
- `dist/` — **gitignored** generated build artifacts
- `harness-installers/<plugin>/output/`, `harness-installers/<plugin>/dogfood-marketplace/` — **gitignored** build artifacts owned by each marketplace plugin builder
- `~/.claude/`, `~/.copilot/`, `~/.radorc/` — **user-level destinations** that the build/installer write to (NOT in the repo)

## Telemetry surface

The `@rad-orchestration/telemetry` library provides opt-in, neutral usage capture. The feature spans four modules — consult each module's own `AGENTS.md` for full detail:

- [`harness-installers/shared/hooks/`](./harness-installers/shared/hooks/) — single-source telemetry capture shim (`telemetry-capture.mjs`) and preamble shim (`session-preamble.mjs`), shared across all installer variants
- [`harness-installers/standard/`](./harness-installers/standard/) — standard installer wiring: copies the hooks and registers the `PostToolUse`/`Stop`/`SessionEnd` hook entries
- [`harness-installers/claude-plugin/`](./harness-installers/claude-plugin/) — Claude marketplace plugin wiring for the same hook set
- [`ui/`](./ui/) — dashboard Observability toggle (`telemetry.enabled` Switch in the config editor) and the `· observability \`on\`` preamble indicator
