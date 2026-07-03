# rad-master-plan-benchmark-v2

A **performance baseline** harness for the **master-document creation step** of the
`/rad-plan` pipeline, fed the **new requirement-grouped `R{n}`** Requirements format. Drives
the real `/rad-plan` skill against a fixed, pre-built Requirements fixture so you can measure
the **speed, token efficiency, and output artifacts** of building (and exploding) the Master
Plan — then re-measure after a refactor and compare.

This is **not** a regression alarm (that's what `extra-high-pipeline-e2e` is). There is no
linter pass/fail gate. The deliverables of a run are:

1. **A captured observability session** — full token/time spend, comparable session-to-
   session in the dashboard.
2. **A versioned artifact folder** (`output/run-N/`) — the full project output (the approved
   Requirements doc, Master Plan, exploded phases/tasks), diffable against other runs.

## V1 vs V2 — why two tests

This benchmark exists as a **pair**:

| | `…-v1` (sibling) | `…-v2` (this) |
|---|---|---|
| Requirements fixture | **old FR/NFR/AD/DD ledger** | **new requirement-grouped `R{n}`** |
| Native pairing | the **current** master-plan skill | the **post-PLANNING-OVERHAUL-2** skill |

The old master-plan skill is built around the FR/NFR/AD/DD ledger; the PO-2 rewrite is built
around the `R{n}` format that landed in PLANNING-OVERHAUL-1. To compare the two *fairly*,
each is fed the requirements shape it was designed for — otherwise you conflate "skill
quality" with "skill choking on an out-of-distribution input." Both fixtures describe the
**same `rainbow-hello` concept**, so the only variable is the requirements format (and the
skill built for it).

**Intended use of V2:** the **new-world baseline**. The key run is taken **after PO-2 lands**,
against the rewritten master-plan skill (its native `R{n}` pairing). Running it **now**,
against the current skill, is also useful — it shows how the old skill copes with the new
`R{n}` shape (the off-diagonal of a 2×2 with V1).

## What it exercises

The real planning pipeline, driven **directly** (the runner is a simulated orchestrator —
it signals `radorch pipeline` events itself rather than invoking `/rad-plan`). The fixture is
**seeded as the requirements ledger** — the planner never authors requirements — so the run
isolates the master-document creation step:

```
tier menu → size menu                        (operator's choice)
  → start                                    (engine recommends spawn_requirements — IGNORED)
    → requirements_completed (seed fixture)  ← the requirements skip; no authoring spend
      → master_plan (@planner)
        → explode master plan (subcommand)
          → request_plan_approval            ← HALT (run plan audit here; do not approve)
```

Everything from the Master Plan authoring onward is the measured spend, including the audit
that runs while parked at the gate. There is **no** requirements-authoring spend — that's the
isolation.

> Why direct-drive instead of `/rad-plan`: the installed `/rad-plan`+pipeline **authors** a
> fresh Requirements doc on `start` (it does not consume a pre-staged one), which would
> overwrite the fixture and add authoring spend. Driving the engine directly and seeding the
> fixture via `requirements_completed` is what keeps the baseline clean.

## How to run

1. Open a **fresh** Claude Code session at the repo root. Fresh matters — prior context
   skews the spend you're measuring.
2. Paste `_runner.md` as the kickoff prompt.
3. The session stages the fixture, answers the two menus (your choice of tier/size), then
   drives the pipeline directly — seeding the fixture as the requirements ledger (no
   `/rad-plan`, no requirements authoring) — to the plan-approval gate.
4. It halts **without approving** and prints the observability session URL.

### Configuration

| Knob | Value |
|------|-------|
| Project name | `RAD-MASTER-BENCH-V2` (pinned — stable, diffable filenames) |
| Fixture | `rainbow-hello` (new requirement-grouped `R{n}` format) |
| Tier | **operator-selected live** — not pinned |
| Phase/Task size | **operator-selected live** — not pinned |

Tier and size are **not** hardcoded — choosing them is part of what this harness explores.
To compare runs, hold both constant across the comparison set and record which you used.

### Comparing runs

- **Spend:** open the two sessions in the observability dashboard
  (`http://localhost:3000/observability/session/<id>`) and compare.
- **Artifacts:** `diff -r output/run-1/RAD-MASTER-BENCH-V2 output/run-2/RAD-MASTER-BENCH-V2`.
  Filenames are identical across runs because the project name is fixed.
- **Cross-version:** diff this V2 master plan / explosion against the V1 sibling's to see the
  new-format (and, after PO-2, new-skill) world versus the old-format / old-skill world.

> Planner output is non-deterministic by design. A single before/after pair can be fooled by
> sampling noise — take **3 runs per side** and compare medians when a delta looks marginal.

## Output & version control

The **full project artifact set** under `output/run-N/RAD-MASTER-BENCH-V2/` is committed —
the approved Requirements doc, Master Plan, audit report, and the exploded `phases/` and
`tasks/`. Only pure runtime churn is gitignored:

- `state.json` — pipeline runtime state (absolute paths, timestamps)
- `template.yml` — identical snapshot every run
- `backups/` — explosion-script scratch

See the `rad-master-plan-benchmark-v2` block in the repo-root `.gitignore`.

## Fixture

| Fixture | Source | Shape |
|---------|--------|-------|
| `rainbow-hello` | authored in the PLANNING-OVERHAUL-1 requirements template shape | New requirement-grouped `R{n}` — R1..R6 feature units (banner, rainbow color, CLI lifecycle, zero-dep packaging, tested renderer, README) for the rainbow ASCII "HELLO WORLD" CLI. Same concept as the V1 sibling, new format. |

The fixture mirrors the V1 sibling's rainbow-hello concept 1:1 so the only variable between
the two tests is the requirements format.
