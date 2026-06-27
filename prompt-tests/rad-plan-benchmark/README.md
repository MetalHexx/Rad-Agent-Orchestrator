# rad-plan-benchmark

A **performance baseline** harness for the `/rad-plan` planning pipeline. Drives the real
`/rad-plan` skill against a fixed fixture so you can measure the **speed, token
efficiency, and output artifacts** of the current pipeline — then re-measure after a
refactor and compare.

This is **not** a regression alarm (that's what `extra-high-pipeline-e2e` is). There is
no linter pass/fail gate. The deliverables of a run are:

1. **A captured observability session** — full token/time spend, comparable session-to-
   session in the dashboard.
2. **A versioned artifact folder** (`output/run-N/`) — the full project output
   (Requirements, Master Plan, exploded phases/tasks), diffable against other runs.

## What it exercises

The real `/rad-plan` from invocation to the plan-approval halt:

```
/rad-plan RAD-PLAN-BENCH
  → tier menu (extra-high) → size menu (Small)
    → requirements (@planner)
      → master_plan (@planner) + plan audit
        → explode master plan (script)
          → request_plan_approval  ← HALT (do not approve)
```

Everything in that span is part of the measured planning spend — including the two
interactive menus (deliberately **not** bypassed via args) and the audit that runs inside
the Master Plan step.

## How it differs from `extra-high-pipeline-e2e`

| | `extra-high-pipeline-e2e` | `rad-plan-benchmark` |
|---|---|---|
| Purpose | Regression alarm (catch structural drift) | Performance baseline (tune a refactor) |
| Driver | Hand-rolled simulated orchestrator signalling `radorch pipeline` | The **real `/rad-plan`** skill |
| Tier/size | `--template` passed directly, no menus | Bare invocation — both menus fire and are measured |
| Headline output | linter pass/fail | observability session + versioned artifacts |
| Project location | `output/<fixture>/<project>/` | `output/run-N/RAD-PLAN-BENCH/` (versioned) |

## How to run

1. Open a **fresh** Claude Code session at the repo root. Fresh matters — prior context
   skews the spend you're measuring.
2. Paste `_runner.md` as the kickoff prompt.
3. The session stages the fixture, invokes `/rad-plan RAD-PLAN-BENCH`, answers the two
   pinned menus (`extra-high`, `Small`), and drives to the plan-approval gate.
4. It halts **without approving** and prints the observability session URL.

### Pinned configuration

Held constant so runs are comparable:

| Knob | Value |
|------|-------|
| Project name | `RAD-PLAN-BENCH` |
| Tier | `extra-high` |
| Phase/Task size | `Small` |
| Fixture | `rainbow-hello` |

If a `/rad-plan` refactor changes the menus, update the pinned table in `_runner.md` —
don't improvise menu answers, or you break comparability.

### Comparing runs

- **Spend:** open the two sessions in the observability dashboard
  (`http://localhost:3000/observability/session/<id>`) and compare.
- **Artifacts:** `diff -r output/run-1/RAD-PLAN-BENCH output/run-2/RAD-PLAN-BENCH`.
  Filenames are identical across runs because the project name is fixed.

> Planner output is non-deterministic by design. A single before/after pair can be fooled
> by sampling noise — take **3 runs per side** and compare medians when a delta looks
> marginal.

## Output & version control

The **full project artifact set** under `output/run-N/RAD-PLAN-BENCH/` is committed —
brainstorming copy, Requirements, Master Plan, and the exploded `phases/` and `tasks/`.
Only pure runtime churn is gitignored, because it adds per-machine/per-run diff noise and
isn't an authored artifact:

- `state.json` — pipeline runtime state (absolute paths, timestamps)
- `template.yml` — identical snapshot every run
- `backups/` — explosion-script scratch

See the `prompt-tests/rad-plan-benchmark/` block in the repo-root `.gitignore`.

## Fixture

| Fixture | Source | Shape |
|---------|--------|-------|
| `rainbow-hello` | independent copy of `extra-high-pipeline-e2e/fixtures/rainbow-hello/BRAINSTORMING.md` | Small rainbow ASCII "HELLO WORLD" CLI — cheap to plan, real enough to exercise FR/NFR/AD/DD patterns and a multi-phase plan. |

The copy is independent so the benchmark fixture can't drift when the extra-high fixture
is edited.
