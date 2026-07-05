# rad-plan-benchmark — Runner Prompt

> **Token cost.** This drives the **real `/rad-plan`** end-to-end: two `@planner`
> subagent calls (Requirements, Master Plan) **plus the plan audit** that runs inside
> the Master Plan step. That is real Opus-tier spend per run. Don't loop it without
> intent.

---

## Mission

You are driving the production **`/rad-plan`** skill against a fixed brainstorming
fixture to **baseline the speed, token efficiency, and output artifacts of the current
planning pipeline** — Requirements → Master Plan (+ audit) → explosion → plan-approval
gate.

This is a **measurement harness, not a regression alarm.** There is no pass/fail
assertion to compute. The spend is captured automatically by the observability system
(one session = one benchmark run); the planning artifacts are written under a versioned
`run-N/` folder for artifact-to-artifact comparison across refactors. Your job is to run
`/rad-plan` cleanly to its halt point, leave the full artifact set on disk, and print the
observability deep-link.

Drive the **real `/rad-plan`** — do **not** hand-roll a simulated orchestrator and do
**not** signal `radorch pipeline` events yourself. Invoke the skill and let it own the
pipeline. The only operator interventions are: (1) the project-dir override below, (2)
answering the two pinned menus, and (3) stopping at the plan-approval gate.

## Why no template/size args

`/rad-plan` is invoked with **only the project name** — no template, no size. Choosing
the tier and the phase/task size are interactive `AskUserQuestion` steps inside the
skill, and that interaction is **part of the planning spend we are baselining**. So you
let both menus fire and answer them with the **pinned values** below. The *interaction*
is measured; the *choices* are held constant so runs are comparable.

| Menu | Pinned answer |
|------|---------------|
| Step 1 — Process Template (tier) | **`medium`** |
| Step 2 — Phase/Task Size | **`Large`** |

Pin these every run. If a future `/rad-plan` refactor changes the menus, update this
table — never improvise an answer.

## Inputs

| Input | Value | Notes |
|-------|-------|-------|
| Fixture | `rainbow-hello` | `fixtures/rainbow-hello/BRAINSTORMING.md` — independent copy of the medium fixture. |
| Project name | `RAD-PLAN-BENCH` | Passed as `$0` to `/rad-plan`. Held constant across runs so artifact filenames are identical and diffable. |
| Run number | next free `run-N` | `run-1`, `run-2`, … Pick the lowest integer with no existing folder under `output/`. |

All paths below are relative to the repo root.

## Benchmark project-dir override

`/rad-plan` Step 0 would normally place the project under
`~/.radorc/projects/{project_name}/`. **Override that.** This is a benchmark run:
**wherever `/rad-plan` resolves or creates the project directory, use this path
instead**, so artifacts land in the versioned, repo-local output tree:

```
prompt-tests/rad-plan-benchmark/output/run-N/RAD-PLAN-BENCH/
```

The brainstorming doc is staged there before you invoke the skill (see Setup), so the
skill's convention-based discovery finds it at the overridden location. Everything
downstream in the skill uses the resolved `project_dir`, so this single override carries
through doc discovery, the `start` signal, and every emitted artifact. The pipeline
engine derives the project name from `path.basename(--project-dir)` = `RAD-PLAN-BENCH`,
so doc filenames are stable across runs.

> Trade-off, by design: a redirected project does **not** appear in the dashboard's
> *project* list (that reads `~/.radorc/projects`). That's fine — the **observability
> session** capture is independent of project location, so the spend metrics are intact.
> You compare runs in the observability UI and by diffing the `run-N/` artifact folders.

### Why the redirect is safe (and what could break it)

The planning tier is fully **`project-dir`-driven** — verified against the engine and
explosion-script source. Nothing in the planning path resolves a location from
`~/.radorc/projects`:

- **Pipeline engine** — on `start` it derives the project name from
  `path.basename(--project-dir)`; `state.json`, the template snapshot, directory
  creation, and all doc reads key off `--project-dir`. The lone `~/.radorc/projects`
  constant feeds only `normalizeDocPath`, a relativizer that strips that prefix **when
  present** — our `output/...` paths don't match it, so they pass through untouched.
- **Explosion script** (`plan-explode`) — fully arg-driven (`--project-dir`,
  `--master-plan`, `--project-name`, all required). `phases/`, `tasks/`, `backups/`, and
  `state.json` are every one `path.join(projectDir, …)`. No base-path coupling.
- **`~/.radorc` constants that remain** are either global (the `templates/` dir and
  `orchestration.yml` config, resolved independently of project location — same for every
  run) or **execution-tier** (worktree provisioning), which never fires because this run
  halts at `request_plan_approval`.

Two load-bearing assumptions to keep in mind if a future `/rad-plan` refactor reshapes
things:

1. **Doc-path escape guard.** The engine rejects any doc whose path resolves *outside*
   `--project-dir` (`"Document path escapes project directory"`). Every artifact — staged
   brainstorming doc included — must live under `output/run-N/RAD-PLAN-BENCH/`. The Setup
   step guarantees this; don't point the override at a dir the docs aren't in.
2. **Single `project_dir` variable.** This override works because `/rad-plan` resolves the
   project directory once (Step 0) and references that one variable everywhere downstream.
   If a refactor stops funneling through a single resolved `project_dir` — e.g. it
   re-derives `~/.radorc/projects/{name}` inline at a later step — this override would no
   longer fully propagate and would need revisiting here.

## Setup (bootstrap)

1. Choose the run number `N` (lowest free `run-N` under
   `prompt-tests/rad-plan-benchmark/output/`).
2. Create the project dir and the subdirs the explosion step writes into:
   ```
   prompt-tests/rad-plan-benchmark/output/run-N/RAD-PLAN-BENCH/
     ├── phases/
     ├── tasks/
     └── backups/
   ```
3. Stage the brainstorming fixture into the project dir, renamed to the project
   convention so `/rad-plan` discovers it:
   ```
   prompt-tests/rad-plan-benchmark/fixtures/rainbow-hello/BRAINSTORMING.md
     → output/run-N/RAD-PLAN-BENCH/RAD-PLAN-BENCH-BRAINSTORMING.md
   ```

Do **not** pre-seed `state.json`, `orchestration.yml`, or `template.yml` — `/rad-plan`
and the pipeline engine create those lazily.

## Drive `/rad-plan`

Invoke the skill with the project name only:

```
/rad-plan RAD-PLAN-BENCH
```

- Apply the **project-dir override** above the moment the skill resolves the project
  directory.
- When the **tier** menu appears, choose **`medium`**.
- When the **size** menu appears, choose **`Large`**.
- Let the skill drive the pipeline through Requirements → Master Plan (+ audit) →
  explosion. Do not signal pipeline events yourself; the skill owns the loop.

## Halt

**Stop when the pipeline reaches the plan-approval gate** (`request_plan_approval`).
**Do not approve it.** The run has produced everything the benchmark needs —
Requirements, Master Plan, the audit pass, and the exploded phase/task files — before
the gate. Approving would spend into the execution tier and pollute the planning
baseline.

## Emit the observability deep-link

The spend is already captured by observability under **this session's id**. Print the
dashboard URL so the operator can jump straight to it:

```
http://localhost:1337/observability/session/<SESSION-ID>
```

`<SESSION-ID>` is the UUID in your own scratchpad/session temp path — the last path
segment before `/scratchpad` (e.g. a path ending `…/<SESSION-ID>/scratchpad`). Use that
UUID verbatim.

> The link only resolves if the dashboard is running. If it isn't, note that the
> operator can start it with `/rad-ui-start` (check with `/rad-ui-status`). It serves on
> a configurable port (default 1337, via `ui.port` in `orchestration.yml`).

## Exit

Report to the operator:

- The run folder: `prompt-tests/rad-plan-benchmark/output/run-N/RAD-PLAN-BENCH/`
- A one-line artifact census: requirement count (Requirements frontmatter), phase count,
  task count (so two runs can be compared at a glance).
- The observability session URL.

Then stop. The full project artifact set on disk under `run-N/` plus the observability
session **are** the benchmark output — there is nothing to assert.

If anything halted or surfaced unexpectedly (skill error, pipeline `ok: false`, an
action implying an execution-tier spawn before the gate), stop and surface it to the
operator rather than papering over a broken run.
