# rad-master-plan-benchmark-v2 — Runner Prompt

> **Token cost.** This drives the **real planning pipeline directly** from a pre-built
> Requirements doc: one **inline Master Plan authoring pass** (driven in this main agent)
> **plus the plan audit subagent**. That is real Opus-tier spend per run. Don't loop it
> without intent.

---

## Mission

You are a **simulated orchestrator** driving the production `radorch.mjs` pipeline engine
against a fixed, pre-built **Requirements** fixture, to **baseline the speed, token
efficiency, and output artifacts of the master-document creation step** — Master Plan
authoring → audit → explosion → plan-approval gate.

**The fixture IS the requirements ledger — requirements are never authored here.** This is
the whole point of the harness, and it is what isolates the master-doc step. You seed the
fixture directly on disk as the project's Requirements doc, and the `start` event resolves
straight to `spawn_master_plan`, which reads it. There is **no requirements-authoring spend**
in this run.

> **Do NOT invoke `/rad-plan` here** — this harness drives the engine directly so the run
> isolates the master-doc step.

This is the **V2** test: the fixture is in the **new requirement-grouped `R{n}`** format —
the shape the post-PLANNING-OVERHAUL-2 master-plan skill is built around. (Its sibling **V1**
seeds the old FR/NFR/AD/DD ledger.) See `README.md` for the old-vs-new comparison.

This is a **measurement harness, not a regression alarm.** There is no pass/fail assertion.
The spend is captured automatically by observability (one session = one run); the planning
artifacts are written under a versioned `run-N/` folder for artifact-to-artifact comparison.
Your job: drive the pipeline cleanly to its halt point, leave the full artifact set on disk,
and print the observability deep-link.

**You are simulating the orchestrator, not faking it.** Drive the *real* engine via
`radorch pipeline signal`, read `data.action` / `data.prompt` from the returned JSON, and
follow each envelope's prose. Do **not** hand-edit `state.json` and do **not** fabricate
envelopes. The full routing reference lives at
`~/.claude/skills/rad-orchestration/references/pipeline-guide.md`.

The only operator interventions are: (1) answering the two menus below, and (2) stopping at
the plan-approval gate.

> **Interim note.** Until PLANNING-OVERHAUL-2 lands, running this fixture exercises the
> **old** master-plan skill against the **new** `R{n}` format — a deliberate off-pairing that
> shows how the current skill copes with the new shape. The *native* V2 run is the one taken
> **after PO-2**, against the rewritten skill. Either way the runner mechanics are identical.

## Menus are operator-selected — do NOT hardcode

This harness has **no pinned tier or size** — choosing them is part of the point. Present
both menus live (via `AskUserQuestion`) and record your choices in the exit census.

**Answer both menus yourself, live.** To compare two runs against each other, **hold tier
and size constant across that comparison set** and note which you used — otherwise you break
comparability.

**Step 1 — review-intensity tier** (sets `--template` on the `start` signal):

| Tier | Copy |
|---|---|
| `extra-high` *(Recommended)* | Per-task code review + phase review + final review. Maximum defense in depth. |
| `high` | Per-task code review + final review (no phase review). |
| `medium` | Phase review + final review (no per-task review). Good balance. |
| `low` | Final review only. Fast and efficient. |

**Step 2 — Phase/Task Size** (flows into the inline Master Plan authoring). The
`(Recommended)` marker moves with the tier: `extra-high → Small`, `high → Medium`,
`medium → Large`, `low → Extra Large`.

| Size | Copy |
|---|---|
| `Small` | One named, self-contained change per task — a function, a validator, a constant. 3–5 tasks/phase. |
| `Medium` | A vertical slice through one layer per task: a module, a config section, a CLI command with its tests. 2–4 tasks/phase. |
| `Large` | A full feature slice touching multiple layers or subsystems end-to-end per task. 2–3 tasks/phase. |
| `Extra Large` | A standalone feature per task; phases are thin wrappers. 1–2 tasks/phase. |
| `Custom` | Describe your sizing criterion in your own words; it becomes the authoritative task-scope target. |

> **What actually varies in this benchmark.** The planning prefix
> (requirements → master plan → explode → plan gate) is **identical across all four tiers**,
> and this run **halts before any review** — so for this harness the tier mainly (a) sets
> `--template` on the snapshot and (b) steers the size recommendation. **Size** is the knob
> that actually reshapes the Master Plan (task scoping). Record both anyway for comparability.

## Inputs

| Input | Value | Notes |
|-------|-------|-------|
| Fixture | `rainbow-hello` | `fixtures/rainbow-hello/REQUIREMENTS.md` — new requirement-grouped `R{n}` format. |
| Project name | `RAD-MASTER-BENCH-V2` | The engine derives it from `path.basename(--project-dir)`. Held constant so artifact filenames are identical and diffable. |
| Run number | next free `run-N` | `run-1`, `run-2`, … Pick the lowest integer with no existing folder under `output/`. |

All paths below are relative to the repo root.

## Benchmark project dir

This is a benchmark run, so artifacts land in the versioned, repo-local output tree rather
than `~/.radorc/projects/`. Use this path as `--project-dir` on **every** signal:

```
prompt-tests/rad-master-plan-benchmark-v2/output/run-N/RAD-MASTER-BENCH-V2/
```

The engine derives the project name from `path.basename(--project-dir)` = `RAD-MASTER-BENCH-V2`,
so doc filenames are stable across runs. `state.json`, the `template.yml` snapshot, directory
creation, and all doc reads key off `--project-dir`; the explosion subcommand is fully
arg-driven (`--project-dir`, `--master-plan`, `--project-name`). Keep **every** artifact —
the staged Requirements fixture included — under this directory.

> Trade-off, by design: a redirected project does **not** appear in the dashboard's
> *project* list (that reads `~/.radorc/projects`). That's fine — the **observability
> session** capture is independent of project location, so the spend metrics are intact. You
> compare runs in the observability UI and by diffing the `run-N/` artifact folders.

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
3. Stage the Requirements fixture into the project dir, renamed to the project convention:
   ```
   prompt-tests/rad-master-plan-benchmark-v2/fixtures/rainbow-hello/REQUIREMENTS.md
     → output/run-N/RAD-MASTER-BENCH-V2/RAD-MASTER-BENCH-V2-REQUIREMENTS.md
   ```

Do **not** pre-seed `state.json`, `orchestration.yml`, or `template.yml` — the pipeline
engine creates those lazily on the first event.

## Drive the planning pipeline

Invoke `radorch pipeline signal` from the repo root. After each call, parse the JSON
envelope on stdout and act on `data.action` / `data.prompt`; the embedded `Signal:` line in
`data.prompt` is authoritative for the next event name and its flags. `<DIR>` below =
`prompt-tests/rad-master-plan-benchmark-v2/output/run-N/RAD-MASTER-BENCH-V2`.

**1. `start`** — with the tier from Step 1. Returns action `spawn_master_plan`.

```
node ~/.claude/skills/rad-orchestration/scripts/radorch.mjs pipeline signal \
  --event start \
  --project-dir <DIR> \
  --template <tier>
```

**2. Master Plan** — follow the `spawn_master_plan` envelope's `data.prompt`, but **author the
Master Plan yourself, inline in this main agent chat**, following `rad-create-plans`
`master-plan` mode. You already hold the seeded Requirements
fixture — read it as the source of the requirement substance each task must carry. Use the
`repository_skills_block` from `data.context` as authoring context (when empty, ignore it).
**Apply the sizing amendment verbatim** as you author:

> "Task size preference: {size}. Size all tasks according to that tier per the sizing rubric
> in the master-plan workflow."

(When the size is `Custom: …`, the prose flows through verbatim.) Write
`RAD-MASTER-BENCH-V2-MASTER-PLAN.md`. Confirm it exists, then signal `master_plan_completed`
(returns action `explode_master_plan`):

```
node ~/.claude/skills/rad-orchestration/scripts/radorch.mjs pipeline signal \
  --event master_plan_completed \
  --project-dir <DIR> \
  --doc-path RAD-MASTER-BENCH-V2-MASTER-PLAN.md
```

**3. Explode** — run the explosion **subcommand** (no agent spawn) exactly as the
`explode_master_plan` envelope's `data.prompt` specifies; it carries the correct
`--project-dir`, `--master-plan`, and `--project-name`. Shape:

```
node ~/.claude/skills/rad-orchestration/scripts/radorch.mjs plan explode \
  --project-dir <DIR> \
  --master-plan <DIR>/RAD-MASTER-BENCH-V2-MASTER-PLAN.md \
  --project-name RAD-MASTER-BENCH-V2
```

On exit 0, read `data.emittedPhases` / `data.emittedTasks`, then signal `explosion_completed`
(returns action `request_plan_approval`). On exit 2 (parse failure) signal
`explosion_failed --parse-error '<json>'`; on exit 1, halt and surface.

```
node ~/.claude/skills/rad-orchestration/scripts/radorch.mjs pipeline signal \
  --event explosion_completed \
  --project-dir <DIR>
```

**4. Audit (while parked at the gate, before approval).** When the pipeline returns
`request_plan_approval`, run the plan audit before doing anything with the gate:

- Dispatch a **`general-purpose`** subagent to audit the Requirements doc and the Master Plan.
  Give it both doc paths (Requirements + Master Plan) and instruct it to follow
  `~/.claude/skills/rad-plan/references/audit.md`. It returns a structured report with
  frontmatter `verdict: approved` or `verdict: issues_found`. The auditor does **not** edit
  either doc.
- If `verdict: approved` → done.
- If `verdict: issues_found`:
  1. **Apply the fixes yourself, inline** in the Master Plan doc — you own it. Action the
     auditor's findings and note any you decline and why.
  2. Re-run the `plan explode` subcommand (step 3) to regenerate `phases/` and `tasks/` from
     the corrected Master Plan. It auto-backs-up the pre-correction artifacts into
     `backups/{ISO-timestamp}/`. On exit 2, surface the structured `data.error` and halt.
- Single pass — no re-audit after corrections. Show the operator the concise audit report,
  the corrections summary, and (when re-exploded) the backup directory path.

## Halt

**Stop here, at the plan-approval gate** (`request_plan_approval`). **Do not signal
`plan_approved`.** The run has produced everything the benchmark needs — the seeded
Requirements ledger, the Master Plan, the audit pass, and the exploded phase/task files —
before the gate. Approving would spend into the execution tier and pollute the baseline.

If any execution-side action (`spawn_code_reviewer`, `gate_task`, `gate_phase`, etc.) appears
before the halt, the harness is off-script — stop and surface to the operator.

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

If anything halted or surfaced unexpectedly (engine error, pipeline `ok: false`, an action
implying an execution-tier spawn before the gate), stop and surface it to the operator rather
than papering over a broken run.
