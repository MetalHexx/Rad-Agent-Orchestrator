# Changelog

All notable changes to this project are documented here. Each `## v{version}` entry below is the source of that release's notes on the [GitHub Releases page](https://github.com/MetalHexx/RadOrchestration/releases) — the publish workflow slices the matching block into the release.

---

## Unreleased

### What's Changed

- **Worktree-launch folded into `/rad-execute`** — The previously separate worktree-launch command has been retired. Running `/rad-execute` from the main clone now launches a fresh worktree and branch automatically; running it from inside an existing worktree executes in place after a confirmation. No separate command is needed.

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
