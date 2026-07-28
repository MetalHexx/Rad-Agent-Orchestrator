# Changelog

All notable changes to this project are documented here. Each `## v{version}` entry below is the source of that release's notes on the [GitHub Releases page](https://github.com/MetalHexx/RadOrchestration/releases) — the publish workflow slices the matching block into the release.

---

## Unreleased

_(none)_

---

## v1.0.0-alpha.11 — 2026-07-28

### What's Fixed
- Upgrades from 1.0.0-alpha.9 no longer fail with `bundled manifest not found` — the release engine was deleting each harness's prior-version manifest on every bump, violating the installer's own upgrade contract (AD-4). Manifests now accumulate correctly for the standard installer, and each plugin's single hand-authored manifest is renamed forward as before.
- `npx rad-orc` now always installs the newest published version. The npm `latest` dist-tag was stuck on the very first published version (1.0.0-alpha.9) because npm force-tags a package's first-ever publish regardless of the `--tag` flag used; CI now always repoints `latest` at whatever version it just published.

This release ships the actual fix for both issues to npm — 1.0.0-alpha.10 was published before the manifest fix landed, so anyone still on alpha.9 needs this version to upgrade cleanly.
## v1.0.0-alpha.10 — 2026-07-28

### What's New
_(none)_

### What's Fixed
- fix(ci): stop manifest drift gate from clobbering published ui.tgz (#193)

### Changes
- Enable telemetry by default, pin UI port, and make config gear icon global (#194)

## v1.0.0-alpha.9 — 2026-07-28

The largest release since the process refactor: a brand-new observability and telemetry stack, multi-repo orchestration, a work-graph that relates projects to each other, a rebuilt installer and plugin distribution story, and a planning flow that collapses to a single requirements conversation plus a Master Plan.

### What's New

- **Observability & telemetry** — An entirely new subsystem, off by default and opt-in via `orchestration.yml`. A harness-neutral capture library records per-request token usage to NDJSON with daily partitioning, and a new **Observability** dashboard section reads it live over SSE. Includes an all-sessions surface with spend/duration/rate cards and time-range filters, a per-session detail view with a spend-rate chart and subagent cost breakdown, and an **Agent Inspector** with a live transcript viewer plus Overview, Tools, and Files Touched facets. Costs are priced per model and per token class (input, output, cache-read, cache-create) at the record's own timestamp.
- **Multi-repo orchestration** — Projects can now span several repositories. A new repo registry manages repos and repo-groups; each Master Plan task declares a **Target repo**, phases derive their repo set as the union of their tasks, and the pipeline fans out per-repo across signal, state, execution, review, and source control. A new **Source Control** panel shows per-repo branch, bind status, and location kind (worktree / in-place / side-project), deep-linked to the Repo Registry.
- **Work graph & project relationships** — A new work-graph library and `/rad-project` skill let projects declare relationships to one another, resolve where you're working from, and surface the active set. A structured session preamble reports registered repos, repo-groups, and active projects at session start.
- **`/rad-repo` skill** — Register, bind, describe, and group repositories from chat, so work that spans repos no longer assumes the current directory is the whole system.
- **`/rad-visual-docs` skill** — Extracted into a standalone skill for wireframes, UI mockups, and architecture / data-flow / sequence diagrams. Mockups are clean and grounded by default — annotations are opt-in, and every rendered element must trace back to the conversation.
- **Live dashboard** — Artifacts, project state, and the registry now stream to the UI over SSE with a supervised file watcher, so documents and pipeline state update in place instead of on refresh. Adds a launch screen with an artifact viewer, a unified document modal that addresses every document (including phase plans, task handoffs, and review reports) by path with deep links and toggleable frontmatter, and DAG planning cards that surface Requirements/Master Plan status inline.
- **Configurable dashboard port** — The UI port is sourced from `orchestration.yml` (`ui.port`, default `1337`) and editable from the dashboard config editor.
- **UI control skills** — `/rad-ui-start`, `/rad-ui-status`, and `/rad-ui-stop` for launching, diagnosing, and stopping the dashboard.

### What's Changed

- **Planning overhaul** — The requirements document is now requirement-grouped (`R{n}`), co-locating functional, design, and technical detail per requirement in place of the old FR/NFR/AD/DD ledger. `/rad-brainstorm` is a pure collaboration partner — there is no longer a separate brainstorming document; the requirements doc is scribed inline as consensus forms, and `/rad-plan` starts from it. Master Plan authoring, the plan audit, and approval all moved onto the main agent, retiring the standalone `planner` agent and the `rad-plan-audit` / `rad-approve-plan` skills. Tasks route by **complexity** (`simple` / `standard` / `complex`) rather than requirement tags, and the prescriptive per-phase task caps are gone.
- **New distribution model** — The installer was rearchitected and the npm package renamed **`rad-orchestration` → `rad-orc`**. Alongside the standard installer, the system now ships as three marketplace plugins — Claude Code, GitHub Copilot CLI, and Copilot in VS Code — published to a satellite marketplace repo. The canonical user-data root is standardized at `~/.radorc`. Publishing is now CI-owned: pushing a `v*` tag builds, gates, publishes to npm with provenance, and cuts the GitHub Release.
- **Worktree-launch folded into `/rad-execute`** — The separate worktree-launch command is retired. Running `/rad-execute` from the main clone launches a fresh worktree and branch automatically; running it from inside an existing worktree executes in place after a confirmation.
- **Lower agent token spend** — Coder and reviewer skills were reworked for turn economy, and task handoffs are now *compile-complete*: the planner inlines each external dependency's import-ready contract so the coder never sweeps engine source to orient. Measured on an A/B benchmark: cache-read **14.9M → 6.5M (−57%)**, engine-source file reads 22 → 0, peak context 281K → 176K, with identical output.
- **Orchestrator agent retired** — The pipeline drives from skills; the `orchestrator` agent and its Copilot launch pin are gone. Also retired: the `rad-configure-system`, `rad-execute-parallel`, `rad-plan-quick`, and `rad-run-tests` skills.
- **Monorepo on npm workspaces** — Shared libraries (`repo-registry`, `work-graph`, `telemetry`) build to `dist/` and are consumed by name across the CLI, UI, and installers.
- **CI coverage** — New gates for installer-manifest drift and the four installer test suites, which were previously never run in CI. Installer manifests are now a hash-free path catalog that regenerates byte-identically on any OS, ending the recurring manifest-resync churn.

### What's Fixed

- **Dashboard cost now reconciles with terminal `/cost`** — Claude Code writes 100% 1-hour prompt cache, but capture flattened cache-creation to a single total and priced all of it at the 5-minute rate, undercounting spend. Cache-creation is now split by TTL and priced correctly.
- **Token totals no longer inflated** — Transcript parsing summed every raw line instead of one contribution per request, multiplying cache-read and output tokens up to 4× on multi-line requests. Both the harvest and modal paths now resolve a single final value per request.
- **Cross-harness install on Windows** — Installing one harness while another's dashboard held a lock on `~/.radorc/ui/` raised an EPERM that bricked the install. Every install path now stops a live UI first, keeps staging retry-safe, and no longer wipes the plugin payload on a transient failure.
- **Spawned agents can open their documents** — Doc paths on the pipeline envelope (handoff, review report, phase plan, requirements) are now emitted absolute, so a coder or reviewer can open them directly from its worktree.
- **Dashboard navigation** — Stale document pulses and badges on project switch and cold load are gone, the sidebar filter survives selecting a project, and the document modal's delete action now resolves subfolder documents correctly.
- **Observability UI** — Token breakdown wrapped in a proper card shell with a tooltip; scroll-lock and repaint-safe reveal fixed in the agent inspector.

---

## v1.0.0-alpha.8 — 2026-05-04

A release focused on multi-harness support, a new pluggable adapter architecture, and a substantially revised documentation set.

### What's New

- **Multi-harness support** — The system now works across Claude Code, GitHub Copilot in VS Code, and GitHub Copilot CLI. A pluggable adapter layer compiles canonical `agents/` and `skills/` into each harness's required shape. Upgrades are manifest-aware — only changed files are updated, preserving local customizations. Uninstall is also supported.
- **Repo skill discovery** — The pipeline now automatically discovers workspace-local `SKILL.md` files and injects them into the planner spawn prompt as a `## Repository Skills Available` section, so the planner can incorporate project-specific tooling without manual wiring.
- **Quick pipeline template** — A lightweight `quick` template for simpler projects that skips brainstorming and goes straight to a single-phase execution loop.
- **Requirements workflow** — The planning skill now includes an explicit requirements phase before the master plan.
- **CI workflow** — GitHub Actions CI now runs tests on every push.

### What's Fixed

- Skill visibility (user-facing vs. agent-internal) is now explicit and consistently enforced across all harnesses.
- Removed a stale `scheduled_tasks.lock` file that could accumulate in long-running projects.
- Repaired broken references left behind from the RAD-SKILL-DISCOVERY rename.

### Changes

- **Documentation rewrite** — All user-facing docs revised for clarity, including a reorganized getting-started guide and a new `harnesses.md`.
- **Prompt regression harnesses** — New end-to-end harnesses for instructions-reach, quick pipeline, and repo skill discovery.
- **Adapter test coverage** — Each harness adapter ships with its own test file.

---

## v1.0.0-alpha.7 — 2026-04-28

A polish release focused on the dashboard — start projects without leaving the UI, a cleaner DAG timeline, smarter sidebar sorting, and a handful of cross-platform fixes.

### What's New

- **Start projects from the dashboard** — the project pane now has a **Start** action that launches a brainstorming or planning session directly into a Claude Code terminal.
- **Unified approval & execution dialogs** — plan approval, final approval, and execute-plan share a single, consistent confirmation popup.
- **DAG timeline, simplified** — execution timeline collapses to a two-layer accordion. Task iterations fold their substeps into the badge label, **Code Review** surfaces as a header link, and a new **Corrected** pill leads the trailing-link cluster on iterations that recovered from a corrective cycle. Iteration vocabulary is unified across **Coding**, **Reviewing**, **Correcting**, **Failed**, and **Halted**, with stage colors resolved consistently across the list and details header.
- **Smarter sidebar sorting** — **Urgency-first** ordering surfaces projects that need attention; **Done-first** reverses while keeping *Not Initialized* pinned to the bottom; **Updated (newest first)** is the new default secondary sort; undefined dates now respect direction. The active tier badge mirrors between the sidebar list and the details header with the in-progress spinner.
- **DAG-ordered planning documents** — phase plans and task handoffs are emitted in topological order so the docs you read match the order the pipeline will execute. Corrective handoffs use a clean `CT-*` label scheme; tail-bucket project prefixes are stripped and title-cased.

### What's Fixed

- **Project names with dots** (e.g., `RELEASE-1.7-TEST`) no longer get rejected by the approve dialog or start-action route.
- **Claude Code terminal launch on Windows** no longer prefixes `/rad-execute` with an unnecessary directory path.
- **Execution skill** loads properly — a stray `disable-model-invocation` flag that blocked model invocation has been removed.
- **`next build`** runs clean — a stray `require()` in the document-ordering tests was tripping the production lint gate.
- **Planning skill task-size descriptions** sharpened so junior/standard/senior coder routing is easier to reason about.

---

## v1.0.0-alpha.6 — 2026-04-24

Large release landing the process refactor — DAG-based pipeline engine, requirements-first planning, orchestrator-mediated corrective cycles, a rewritten executor and reviewer, and a monitoring UI rebuilt on the new state shape.

### Added

- **v5 DAG pipeline engine** — YAML pipeline templates driving a TypeScript engine, structurally validated at load time. Projects snapshot their template at creation. New `orchestration-state-v5.schema.json` with a v4 migration path.
- **Requirements-first planning** — planning collapses from five docs to two (**Requirements** + **Master Plan**); a single `planner` agent authors both, and an explosion step fans the approved plan out into per-phase and per-task docs before approval.
- **Diff-based scoped code review** — task, phase, and final reviews audit the scoped commit diff against the Requirements contract with per-requirement audit tables, scope-aware status (on-track / drift / regression at task/phase; met / missing at final), and an evidence-not-intent rule.
- **Orchestrator-mediated corrective cycles** — on `changes_requested`, the Orchestrator judges findings, writes an addendum, and authors a fresh corrective handoff. Task- and phase-scope cycles share one uniform pattern; reviewers do not carry prior-attempt memory.
- **Executor rewritten to one uniform contract** — `execute-coding-task` is handoff-only, no mode branching; code tasks run mandatory RED-GREEN with an anti-pattern gate and Execution Notes appendix.
- **Coder tiers** — `coder-junior` / `coder` / `coder-senior`, sized per handoff.
- **`rad-plan-audit` as a first-class action** — severity-based audit of Requirements + Master Plan before execution; runs pipeline-spawned or from chat.
- **Per-project source-control preferences** — commit/PR gates read `state.pipeline.source_control.*` instead of global config; `ask`/missing fails fast.
- **Monitoring UI rebuilt on v5** — multi-route App Router with shared header; v5 DAG timeline on `/projects`; new `/process-editor` route with a ReactFlow canvas and YAML↔graph serializer; two-tier sort builder in the sidebar; parallelized project discovery; rebranded to **Rad Orchestration** with the package version in the header.
- **Prompt regression harness** — new top-level `prompt-tests/` covering planning flow, task- and phase-level corrective mediation, code-review rework, and executor rework.
- **Agent + skill surface moved from `.github/` to `.claude/`**; installer gains a `claude-code` AI-tool option.
- **Brainstormer rework** — four new reference docs plus clearer open-questions verification; output feeds straight into the planner handoff.

### Fixed

- **UI memory crash** — SSE watcher and project-file walker no longer descend into `node_modules` / `.git` / `.next` / `.cache`, which had produced Windows EPERM floods and eventually OOM'd Next.js.
- **Autonomous pipeline stall** — `doc_path` is now a first-class iteration field, synthetic `phase_planning` / `task_handoff` step nodes are gone, and the walker self-heals missing body nodes on re-entry.
- **Iteration & corrective Doc button** — restored on iteration headers and corrective-task accordions with proper keyboard reachability.
- **Post-rollout engine bugs** — auto-resolution of phase/task indices, cross-platform path normalization, relative `doc_path` resolution, gate enrichment, and scaffolding ordering.

### Changed

- **Legacy planning surface retired** — `product-manager`, `research`, `architect`, and `ux-designer` agents and their create-* skills removed. `full.yml` stays on disk as a deprecated artifact; `default.yml` is the new default.
- **Source-control agent slimmed** — same `git-commit.js` / `gh-pr.js` execution path as before, but a much thinner driver around them with a clearer responsibility boundary and lower per-invocation cost.
- **Reviewers work from docs, not `state.json`** — state.json references removed from final and phase review workflows.
- **`/projects-v4` hidden from header nav** — route still resolves directly.
- **Version field** present in `installer`, `ui`, and `scripts` package.json so all three stay in lockstep.
