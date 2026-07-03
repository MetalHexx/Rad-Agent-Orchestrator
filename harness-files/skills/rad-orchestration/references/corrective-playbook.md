# Corrective Flow

Reference for the orchestrator's role in a corrective cycle (task-scope or phase-scope). The orchestrator is a **dumb router** here — it does not read findings, does not judge them, and does not author anything. The coder self-mediates its own review; the pipeline engine births and budgets the corrective. This document covers only what the orchestrator actually does. `references/pipeline-guide.md` carries the short version (`## Corrective Flow`) plus the tier-selection policy this document defers to.

---

## What triggers a corrective

A corrective cycle fires off the reviewer's raw `verdict`, nothing else:

| Raw verdict | Orchestrator action |
|---|---|
| `changes_requested` | Signal the completion event (`code_review_completed` / `phase_review_completed`) exactly as you would for any other outcome — same `--doc-path`, no extra flags, nothing authored. The engine reads the raw verdict and births the corrective. |
| `approved` | Signal the completion event. Propagates untouched. |
| `rejected` | Signal the completion event. The mutation routes it into a clean pipeline halt. |

There is no separate mediation signal and no orchestrator-authored frontmatter or addendum. The review doc the reviewer produced is already everything the engine needs to decide.

---

## Re-spawning the coder

When the engine births a corrective, the next `execute_task` action's context carries the same `handoff_doc` as the original task — **unchanged, never re-authored** — plus `review_report_path`, the path to the review doc the reviewer just wrote. Relay both into the coder's spawn prompt:

- `handoff_doc` — same as any task spawn.
- `review_report_path` — tells the coder where its findings live and where to write its own dispositions.

Select the coder's tier per `references/pipeline-guide.md` → "Coder escalation (break-glass)". That document is the single source of truth for the escalation ladder — do not re-derive it here.

The coder reads the review, fixes what's real, and writes a disposition — with justification — for anything it disputes back into the same `review_report_path`. The orchestrator does not read or judge that content; it only relays the path and re-spawns.

---

## Re-review

The re-spawned reviewer (task or phase scope, per `references/pipeline-guide.md` → "Reviewer tier selection") reopens the same `review_report_path` and re-adjudicates it, including the coder's disputes. There is no new review file per cycle — one running report per scope, stable for the life of the task's corrective cycles.

---

## Budget

`max_retries_per_task` (from `orchestration.yml`, default `5`) is the **sole** corrective gate. The engine tracks `corrective_tasks.length` against it and converts an exhausted budget into a clean pipeline halt on its own. The orchestrator does not count attempts, check the budget, or decide when to stop.

---

## Scope: task vs. phase

The flow is identical at both scopes. The only engine-side difference is which iteration hosts the corrective:

- `code_review_completed` correctives append to the active task iteration's `corrective_tasks` — unless the reviewed node lives under an active phase-scope corrective's nodes, in which case they append to that phase iteration's `corrective_tasks` instead (corrective-of-a-corrective).
- `phase_review_completed` correctives append to the active phase iteration's `corrective_tasks`.

This routing is derived from `state.json` by the engine — the orchestrator does not author a scope hint.

**Single-pass phase_review.** `phase_review` runs exactly once per phase iteration. A phase-scope corrective is carried entirely by task-level re-reviews of the phase's sentinel task (`task_id: "P{NN}-PHASE"`); once that task-level review approves, the phase iteration completes directly — the pipeline does not re-dispatch `spawn_phase_reviewer`.

---

## Verify Before Echo (corrective commit signals)

**Scope:** the mutating `task_completed` signal on a corrective path — the one
that records a commit hash. Commit is folded into the task, so a corrective
task's own `task_completed` carries its hash. Not all signals; only this
corrective commit echo.

When you are about to signal `task_completed` for a corrective task, the
`--phase`/`--task`/`--branch` you echo come from `data.context`. On a corrective
path that context can be stale. Before emitting the mutating signal:

1. **Read `state.json`.** Locate the node(s) carrying `status: in_progress`.
2. **Confirm the active node.** On a phase-scope corrective the active node is
   the last entry of the active phase's `corrective_tasks` (its `task_executor`
   sub-node is `in_progress`); the echoed context should carry that phase's
   identity with the phase-scope task sentinel (`task_number: null`,
   `task_id: "P{NN}-PHASE"`).
3. **Confirm the identifiers address that node.** If `--phase`/`--task` do not
   resolve to the `in_progress` node, **do not emit `task_completed`.** Inspect
   and correct first — re-derive the correct identifiers from the markers, or
   re-signal `start` (non-mutating) to let the engine recompute the action
   context.
4. **Never echo a context you have flagged as stale into a mutation.** A
   finalized commit hash is immutable; the engine refuses a stale echo — and a
   commit reported off its intended branch — with `ok: false`, but the rule is
   to catch it before the signal, not rely on the engine's catch-net.

This is a standing rule: a future orchestrator agent facing the same
stale-context signal halts and verifies rather than echoing into a mutation.
