# rad-master-plan-benchmark-v1

A **performance baseline** harness for the **master-document creation step** of the
`/rad-plan` pipeline, fed the **old FR/NFR/AD/DD ledger** Requirements format. Drives the
real `/rad-plan` skill against a fixed, pre-built Requirements fixture so you can measure the
**speed, token efficiency, and output artifacts** of building (and exploding) the Master
Plan — then re-measure after a refactor and compare.

This is **not** a regression alarm (that's what `extra-high-pipeline-e2e` is). There is no
linter pass/fail gate. The deliverables of a run are:

1. **A captured observability session** — full token/time spend, comparable session-to-
   session in the dashboard.
2. **A versioned artifact folder** (`output/run-N/`) — the full project output (the approved
   Requirements doc, Master Plan, exploded phases/tasks), diffable against other runs.

## V1 vs V2 — why two tests

This benchmark exists as a **pair**:

| | `…-v1` (this) | `…-v2` (sibling) |
|---|---|---|
| Requirements fixture | **old FR/NFR/AD/DD ledger** | **new requirement-grouped `R{n}`** |
| Native pairing | the **current** master-plan skill | the **post-PLANNING-OVERHAUL-2** skill |

The old master-plan skill is built around the FR/NFR/AD/DD ledger; the PO-2 rewrite is built
around the `R{n}` format that landed in PLANNING-OVERHAUL-1. To compare the two *fairly*,
each is fed the requirements shape it was designed for — otherwise you conflate "skill
quality" with "skill choking on an out-of-distribution input." Both fixtures describe the
**same `rainbow-hello` concept**, so the only variable is the requirements format (and the
skill built for it).

**Intended use of V1:** the **old-world baseline** — run it **now**, against the current
master-plan skill (its native FR/NFR/AD/DD pairing). After PO-2 you may optionally rerun it
to see the new skill handle a legacy-format doc (the off-diagonal of a 2×2).

## What it exercises

The real `/rad-plan` from invocation to the plan-approval halt. Post-PO-1, `/rad-plan`
**consumes** the seeded Requirements doc and does **not** author one:

```
/rad-plan RAD-MASTER-BENCH-V1
  → require + approve Requirements doc (Step 0 / 0.5)
    → tier menu → size menu              (operator's choice)
      → master_plan (@planner) + plan audit
        → explode master plan (script)
          → request_plan_approval        ← HALT (do not approve)
```

Everything from the Master Plan authoring onward is the measured spend, including the audit
that runs inside the Master Plan step. There is **no** requirements-authoring spend — that's
the isolation.

## How to run

1. Open a **fresh** Claude Code session at the repo root. Fresh matters — prior context
   skews the spend you're measuring.
2. Paste `_runner.md` as the kickoff prompt.
3. The session stages the fixture, invokes `/rad-plan RAD-MASTER-BENCH-V1`, **approves** the
   Requirements doc, answers the two menus (your choice of tier/size), and drives to the
   plan-approval gate.
4. It halts **without approving** and prints the observability session URL.

### Configuration

| Knob | Value |
|------|-------|
| Project name | `RAD-MASTER-BENCH-V1` (pinned — stable, diffable filenames) |
| Fixture | `rainbow-hello` (old FR/NFR/AD/DD ledger, 22 requirements) |
| Tier | **operator-selected live** — not pinned |
| Phase/Task size | **operator-selected live** — not pinned |

Tier and size are **not** hardcoded — choosing them is part of what this harness explores.
To compare runs, hold both constant across the comparison set and record which you used.

### Comparing runs

- **Spend:** open the two sessions in the observability dashboard
  (`http://localhost:3000/observability/session/<id>`) and compare.
- **Artifacts:** `diff -r output/run-1/RAD-MASTER-BENCH-V1 output/run-2/RAD-MASTER-BENCH-V1`.
  Filenames are identical across runs because the project name is fixed.
- **Cross-version:** diff this V1 master plan / explosion against the V2 sibling's to see the
  old-format / old-skill world versus the new-format (and, after PO-2, new-skill) world.

> Planner output is non-deterministic by design. A single before/after pair can be fooled by
> sampling noise — take **3 runs per side** and compare medians when a delta looks marginal.

## Output & version control

The **full project artifact set** under `output/run-N/RAD-MASTER-BENCH-V1/` is committed —
the approved Requirements doc, Master Plan, audit report, and the exploded `phases/` and
`tasks/`. Only pure runtime churn is gitignored:

- `state.json` — pipeline runtime state (absolute paths, timestamps)
- `template.yml` — identical snapshot every run
- `backups/` — explosion-script scratch

See the `rad-master-plan-benchmark-v1` block in the repo-root `.gitignore`.

## Fixture

| Fixture | Source | Shape |
|---------|--------|-------|
| `rainbow-hello` | copy of `rad-plan-benchmark/output/run-7/RAD-PLAN-BENCH/RAD-PLAN-BENCH-REQUIREMENTS.md`, frontmatter renamed to this project | Old FR/NFR/AD/DD ledger — 22 requirements (FR-1..8, NFR-1..5, AD-1..5, DD-1..4) for the rainbow ASCII "HELLO WORLD" CLI. |

The copy is independent so this fixture can't drift when the source run is touched.
