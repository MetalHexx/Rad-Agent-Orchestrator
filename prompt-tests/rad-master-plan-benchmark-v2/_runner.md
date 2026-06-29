# rad-master-plan-benchmark-v2 — Runner Prompt

> **Token cost.** This drives the **real `/rad-plan`** from a pre-built Requirements doc:
> one `@planner` Master Plan authoring call **plus the plan audit**. That is real Opus-tier
> spend per run. Don't loop it without intent.

---

## Mission

You are driving the production **`/rad-plan`** skill against a fixed, pre-built
**Requirements** fixture to **baseline the speed, token efficiency, and output artifacts of
the master-document creation step** — Master Plan authoring → audit → explosion →
plan-approval gate.

Post-PLANNING-OVERHAUL-1, `/rad-plan` **consumes** an existing Requirements doc and **does
not author one** (its Step 0 requires the doc; absent → it halts). So seeding the fixture
*is* what isolates the master-doc step: there is no requirements-authoring spend in this run.

This is the **V2** test: the fixture is in the **new requirement-grouped `R{n}`** format —
the shape the post-PLANNING-OVERHAUL-2 master-plan skill is built around. (Its sibling **V1**
seeds the old FR/NFR/AD/DD ledger.) See `README.md` for the old-vs-new comparison.

This is a **measurement harness, not a regression alarm.** There is no pass/fail assertion.
The spend is captured automatically by observability (one session = one run); the planning
artifacts are written under a versioned `run-N/` folder for artifact-to-artifact comparison.
Your job: run `/rad-plan` cleanly to its halt point, leave the full artifact set on disk,
and print the observability deep-link.

Drive the **real `/rad-plan`** — do **not** hand-roll a simulated orchestrator and do
**not** signal `radorch pipeline` events yourself. Invoke the skill and let it own the
pipeline. The only operator interventions are: (1) the project-dir override below, (2)
approving the Requirements doc at Step 0.5, (3) answering the two menus, and (4) stopping at
the plan-approval gate.

> **Interim note.** Until PLANNING-OVERHAUL-2 lands, running this fixture exercises the
> **old** master-plan skill against the **new** `R{n}` format — a deliberate off-pairing that
> shows how the current skill copes with the new shape. The *native* V2 run is the one taken
> **after PO-2**, against the rewritten skill. Either way the runner mechanics are identical.

## Menus are operator-selected — do NOT hardcode

`/rad-plan` is invoked with **only the project name** — no template, no size. Choosing the
review-intensity **tier** (Step 1) and the **Phase/Task Size** (Step 2) are interactive
`AskUserQuestion` steps, and exploring those choices is part of the point of this harness.

**Answer both menus yourself, live.** There are no pinned values. To compare two runs
against each other, **hold tier and size constant across that comparison set** and note
which you used — otherwise you break comparability. Record your choices in the exit census.

## Inputs

| Input | Value | Notes |
|-------|-------|-------|
| Fixture | `rainbow-hello` | `fixtures/rainbow-hello/REQUIREMENTS.md` — new requirement-grouped `R{n}` format. |
| Project name | `RAD-MASTER-BENCH-V2` | Passed as `$0` to `/rad-plan`. Held constant so artifact filenames are identical and diffable. |
| Run number | next free `run-N` | `run-1`, `run-2`, … Pick the lowest integer with no existing folder under `output/`. |

All paths below are relative to the repo root.

## Benchmark project-dir override

`/rad-plan` Step 0 would normally place the project under
`~/.radorc/projects/{project_name}/`. **Override that.** This is a benchmark run:
**wherever `/rad-plan` resolves or creates the project directory, use this path instead**,
so artifacts land in the versioned, repo-local output tree:

```
prompt-tests/rad-master-plan-benchmark-v2/output/run-N/RAD-MASTER-BENCH-V2/
```

The Requirements doc is staged there before you invoke the skill (see Setup), so the skill's
convention-based discovery finds it at the overridden location. Everything downstream uses
the resolved `project_dir`, so this single override carries through doc discovery, the
`start` signal, and every emitted artifact. The pipeline engine derives the project name
from `path.basename(--project-dir)` = `RAD-MASTER-BENCH-V2`, so doc filenames are stable.

> Trade-off, by design: a redirected project does **not** appear in the dashboard's
> *project* list (that reads `~/.radorc/projects`). That's fine — the **observability
> session** capture is independent of project location, so the spend metrics are intact.
> You compare runs in the observability UI and by diffing the `run-N/` artifact folders.

### Why the redirect is safe

The planning tier is fully **`project-dir`-driven**. On `start` the engine derives the
project name from `path.basename(--project-dir)`; `state.json`, the template snapshot,
directory creation, and all doc reads key off `--project-dir`. The explosion script
(`plan-explode`) is fully arg-driven (`--project-dir`, `--master-plan`, `--project-name`).
Two load-bearing assumptions if a future `/rad-plan` refactor reshapes things:

1. **Doc-path escape guard.** The engine rejects any doc whose path resolves *outside*
   `--project-dir`. Every artifact — the staged Requirements doc included — must live under
   `output/run-N/RAD-MASTER-BENCH-V2/`. The Setup step guarantees this.
2. **Single `project_dir` variable.** This works because `/rad-plan` resolves the project
   directory once (Step 0) and references that one variable everywhere downstream. If a
   refactor stops funneling through a single resolved `project_dir`, revisit this override.

## Setup (bootstrap)

1. Choose the run number `N` (lowest free `run-N` under
   `prompt-tests/rad-master-plan-benchmark-v2/output/`).
2. Create the project dir and the subdirs the explosion step writes into:
   ```
   prompt-tests/rad-master-plan-benchmark-v2/output/run-N/RAD-MASTER-BENCH-V2/
     ├── phases/
     ├── tasks/
     └── backups/
   ```
3. Stage the Requirements fixture into the project dir, renamed to the project convention so
   `/rad-plan` Step 0 discovers it:
   ```
   prompt-tests/rad-master-plan-benchmark-v2/fixtures/rainbow-hello/REQUIREMENTS.md
     → output/run-N/RAD-MASTER-BENCH-V2/RAD-MASTER-BENCH-V2-REQUIREMENTS.md
   ```

Do **not** pre-seed `state.json`, `orchestration.yml`, or `template.yml` — `/rad-plan` and
the pipeline engine create those lazily.

## Drive `/rad-plan`

Invoke the skill with the project name only:

```
/rad-plan RAD-MASTER-BENCH-V2
```

- Apply the **project-dir override** above the moment the skill resolves the project dir.
- At **Step 0.5 (Requirements approval)**, choose **approve** — no revisions. The fixture
  has no Open Questions, so approval is clean and the run proceeds straight into master-plan
  scribing.
- When the **tier** menu appears (Step 1), choose your tier (operator's choice).
- When the **size** menu appears (Step 2), choose your Phase/Task Size (operator's choice).
- Let the skill drive Master Plan → audit → explosion. Do not signal pipeline events
  yourself; the skill owns the loop.

## Halt

**Stop when the pipeline reaches the plan-approval gate** (`request_plan_approval`).
**Do not approve it.** The run has produced everything the benchmark needs — the approved
Requirements doc, the Master Plan, the audit pass, and the exploded phase/task files —
before the gate. Approving would spend into the execution tier and pollute the baseline.

## Emit the observability deep-link

The spend is already captured by observability under **this session's id**. Print the
dashboard URL so the operator can jump straight to it:

```
http://localhost:3000/observability/session/<SESSION-ID>
```

`<SESSION-ID>` is the UUID in your own scratchpad/session temp path — the last path segment
before `/scratchpad`. Use that UUID verbatim.

> The link only resolves if the dashboard is running. If it isn't, note that the operator
> can start it with `/rad-ui-start` (check with `/rad-ui-status`).

## Exit

Report to the operator:

- The run folder: `prompt-tests/rad-master-plan-benchmark-v2/output/run-N/RAD-MASTER-BENCH-V2/`
- **The tier and size you selected** (so the run is interpretable and comparable).
- A one-line artifact census: requirement count (`R{n}` count), phase count, task count.
- The observability session URL.

Then stop. The full project artifact set on disk under `run-N/` plus the observability
session **are** the benchmark output — there is nothing to assert.

If anything halted or surfaced unexpectedly (skill error, pipeline `ok: false`, an action
implying an execution-tier spawn before the gate), stop and surface it to the operator
rather than papering over a broken run.
