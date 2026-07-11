# masterplan-improved-e2e — Runner Prompt

> **Arm B of an A/B pair.** One **general-purpose planning agent** authors a Master Plan from a
> fixed Requirements fixture using the **improved** `rad-create-plans` master-plan guide (the one
> that inlines a compile-complete **External surface** into each task). Arm A
> (`../masterplan-original-e2e/`) authors the *same* plan with the **original** guide. Requirements,
> sandbox, runner, and scope are identical across both arms — the **only** variable is
> `fixtures/skill/`. Compare planner token spend + the emitted task shape across the two.

> **Token cost.** One real planning agent (Opus-tier) + a deterministic explosion subcommand. No
> coder / reviewer / pipeline.

---

## Mission

Author a Master Plan for the `/engine-graph/*` task from a pre-built Requirements fixture,
grounding against an **isolated sandbox** copy of the engine + graph-service host, then explode it
into phase/task docs. You are not scoring anything — you reproduce a faithful, isolated planner run
so an external harness can measure its telemetry and the emitted task's shape.

The planner follows the authoring guide **shipped in this fixture** (`fixtures/skill/`), **not** the
globally-deployed `rad-create-plans` skill — that is what pins the skill version per arm.

## Setup

1. Pick a run folder: `output/run-<LABEL>/` (your harness may set `<LABEL>`; otherwise use today's
   date). All paths below are relative to this behavior folder unless noted.
2. Assemble a **fresh** isolated workspace (copy — never symlink; wipe any stale run folder first):
   ```
   rm -rf   output/run-<LABEL>
   mkdir -p output/run-<LABEL>/ENGINE-GRAPH-BENCH/phases output/run-<LABEL>/ENGINE-GRAPH-BENCH/tasks
   cp -r ../_handoff-sandbox    output/run-<LABEL>/workspace
   cp fixtures/requirements.md  output/run-<LABEL>/ENGINE-GRAPH-BENCH/ENGINE-GRAPH-BENCH-REQUIREMENTS.md
   ```
3. Record absolute paths:
   - project dir = `<abs>/output/run-<LABEL>/ENGINE-GRAPH-BENCH`
   - workspace   = `<abs>/output/run-<LABEL>/workspace`  (the source the planner grounds against)
   - guide       = `<abs>/fixtures/skill/workflow.md`
   - template    = `<abs>/fixtures/skill/templates/MASTER-PLAN.md`

## Drive the planner

Spawn **one `general-purpose` agent** (it has no built-in planner skill, so it can only follow the
guide you hand it — that is the point). Pass, verbatim:

1. **Task** — author a Master Plan at `<project-dir>/ENGINE-GRAPH-BENCH-MASTER-PLAN.md` from the
   seeded Requirements doc `<project-dir>/ENGINE-GRAPH-BENCH-REQUIREMENTS.md`.
2. **How to author** — follow the guide at `<guide>` (master-plan mode) and the template at
   `<template>`. **Ground** by reading the workspace source (`<workspace>`) directly with
   Glob/Grep/Read — the workspace is self-contained; **skip any external tooling / `skill-list`
   step** the guide mentions.
3. **Scope** — author **exactly one phase (`P01`) with exactly one task (`P01-T01`)**: the
   `/engine-graph/*` surface. There are **no** size or review-intensity menus; the scope is fixed.
4. **Frontmatter** — carry the Requirements frontmatter's `project-type`, `repos`, `repo-group` into
   the Master Plan verbatim; set `total_phases: 1`, `total_tasks: 1`.
5. **Isolation fence (include verbatim):**
   > "Work ONLY inside this behavior folder and the workspace path above. Do NOT read anything under
   > any `output/run-*` folder, the sibling `masterplan-original-e2e/` behavior, or any prior run,
   > reference solution, or existing handoff. Author fresh from the Requirements and the code in your
   > workspace."

The agent writes the Master Plan and stops. Do **not** drive any pipeline event or advance any state.

## Explode

Run the deterministic explosion **subcommand** (no agent) to slice the Master Plan into `phases/` +
`tasks/`, exactly as the real pipeline would:

```
node ~/.claude/skills/rad-orchestration/scripts/radorch.mjs plan explode \
  --project-dir <project-dir> \
  --master-plan <project-dir>/ENGINE-GRAPH-BENCH-MASTER-PLAN.md \
  --project-name ENGINE-GRAPH-BENCH
```

- **Exit 0** → the sliced `phases/…` + `tasks/…-P01-T01-….md` are on disk — the task handoff the
  coder *would* receive.
- **Exit 2** (parse failure) → surface the structured `data.error` and **stop**. A compile-complete
  task must still explode cleanly; a parse failure here is the regression this guard exists to catch.
- **Exit 1** → halt and surface.

## Exit

Report to the operator:

- The run folder, the emitted Master Plan path, and the emitted task-handoff path.
- A one-line census: phase count and task count (both should be **1**).
- Hand off to your benchmarking tool to capture the **planning agent's** telemetry (turns,
  cache-read, distinct files read).

Leave all artifacts on disk under `run-<LABEL>/`. There is nothing to assert here — the emitted task
shape and the telemetry **are** the benchmark output.
