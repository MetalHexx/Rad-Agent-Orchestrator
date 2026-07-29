# Slash Commands

This page documents the user-invoked slash commands for the orchestration system. Author-time and plumbing skills — the internal skills that pipeline agents load automatically — are intentionally not listed here. Operators interact with the system through these six commands; everything else runs behind the scenes.

The 3 most important commands are: `/rad-brainstorm`,  `/rad-plan` and `/rad-execute`.  The others are for special cases and convenience.

The shipped review-intensity tiers are `extra-high`, `high`, `medium`, and `low`. They share planning ceremony and final review; they differ only in defensive review depth between planning and final approval. See [Process Templates](pipeline.md#process-templates) for the full matrix.

### /rad-brainstorm

**What it does** — Runs a collaborative ideation session to align goals and capture context before planning begins.

**When to use it** — Use it before non-trivial work to decide whether the work warrants a project series and to gather linked PRDs, design docs, or screenshots that the planners will read.  It is highly recommended you start every project with a brainstorming session.  It's not required, but it will greatly help you align your intent to produce the best possible planning documents when running `/rad-plan` later.

**What it produces** — a draft `{NAME}-REQUIREMENTS.md` at the project root, scribed via `/rad-create-plans` as consensus forms.  It can be linked to a project series (should you choose to create one), and relevant docs and additional context are linked into it for `/rad-plan` to build on.

### /rad-plan

**What it does** — Starts the full planning pipeline from an existing requirements document. Invoking it is itself the approval act; you then pick a review-intensity tier (`extra-high`, `high`, `medium`, `low`) and a Phase/Task Size (`Small`, `Medium`, `Large`, `Extra Large`, or `Custom` prose) in a single batched prompt. The planner then builds the Master Plan and the execution plan from the approved requirements.

The tier governs review depth — `extra-high` runs per-task code review plus phase review plus final review; `low` runs final review only; `high` and `medium` are intermediate. Phase/Task Size independently governs task scope and phase scope, with its own `(Recommended)` default (`Large`) unrelated to the chosen tier.

**When to use it** — Use it after `/rad-brainstorm` has scribed a requirements document, when you want planning ceremony plus the review depth your project needs.

**How to use it** — Type `/rad-plan <PROJECT-NAME>` once a requirements document exists for that project.  If none exists yet, `/rad-plan` points you to `/rad-brainstorm` to create one — that's where you bring your prompt and links to any additional documents, resources, or images for the requirements.

**What it produces** — `{NAME}-MASTER-PLAN.md` and the per-phase and per-task files under `phases/` and `tasks/`, built from the approved `{NAME}-REQUIREMENTS.md`.

### /rad-execute

**What it does** — Runs the approved plan, deciding run location from where you're standing. Invoked from the main clone, it launches a fresh worktree and branch then begins execution there. Invoked from inside an existing worktree, it runs in place after a confirmation. This will begin the coding and code review process, so be sure you've thoroughly read your plans before you use this command.

**When to use it** — Use it after the plan is approved. Run it from the main clone to get an isolated worktree + branch; run it from inside a worktree to execute in place.

**How to use it** - `/rad-execute <PROJECT-NAME>`.  If you don't provide a project name, you will be prompted to select a project.  You must make sure you've already created a plan with `/rad-plan` as a prerequisite to using this command.

**What it produces** — Your final code output.  During the process, you will also see code review documents as you iterate through phases and tasks.

## User-invocable UI skills

Three skills control the dashboard UI lifecycle:

- `rad-ui-start` — launch the dashboard
- `rad-ui-stop` — stop the dashboard
- `rad-ui-status` — show the dashboard's status

On a plugin install, invoke them with the namespaced slash form: `/rad-orchestration:rad-ui-start`, `/rad-orchestration:rad-ui-stop`, `/rad-orchestration:rad-ui-status`. See [plugins.md](plugins.md) for the full slash-command surface.
