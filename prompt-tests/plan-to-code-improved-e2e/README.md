# plan-to-code A/B — the final leg

This pair (`plan-to-code-improved-e2e` = Arm B, `../plan-to-code-original-e2e/` = Arm A) is the last
stage of the **coder-token-diet** project. It proves the *whole* plan→code chain got cheaper: feed a
coder the task the **improved planner produced**, running under the **improved coder skill**, and
show its token/read spend falls well below the original-planner-task-under-original-skill baseline —
with no loss of output quality.

## What this tests (and what it does NOT)

- **Tests code execution only.** The planner is **not** re-run here. Both task handoffs were authored
  in the earlier `masterplan-*-e2e` runs and are **frozen** as `fixtures/handoff.md`. Freezing keeps
  the two stochastic stages (planning, coding) decoupled — we measure the coder against a fixed input.
- Two things move together across the arms because each is the matched output of one pipeline:
  - `fixtures/handoff.md` — the frozen planner-generated task.
  - `fixtures/skill/SKILL.md` — the pinned `rad-execute-coding-task` skill version.

| | Arm A — `plan-to-code-original-e2e` | Arm B — `plan-to-code-improved-e2e` |
|---|---|---|
| handoff | `masterplan-original` P01-T01 — contracts **named, types dangling** | `masterplan-improved` P01-T01 — compile-complete **External surface** inlined |
| coder skill | **old** (`6999e185`, pre-read-economy) | **new** (working tree, "Contracts & read economy") |
| sandbox / scope | identical | identical |

## Mechanism — how the skill is pinned per arm

The runner spawns **one `general-purpose` agent** and tells it its complete operating instructions
are `fixtures/skill/SKILL.md`. A `general-purpose` agent has **no built-in coder skill**, so it can
only follow the fixture — that is what isolates the skill version per arm. (Same trick the
`masterplan-*-e2e` arms used to pin the *planner* guide.) The globally-deployed
`rad-execute-coding-task` skill is never consulted.

## Provenance of the fixtures

- **Handoffs** — copied verbatim from the exploded tasks under
  `masterplan-{improved,original}-e2e/output/run-2026-07-10/ENGINE-GRAPH-BENCH/tasks/…-P01-T01-….md`.
- **Skills** — improved = the working tree at build time (branch `coder-handoff-read-economy`, skill
  commit `9a82a39e`); old = its parent `6999e185` (main's HEAD), extracted with
  `git show 6999e185:harness-files/skills/rad-execute-coding-task/SKILL.md`. The skill is a single
  self-contained file (no `${PLUGIN_ROOT}`, no `references/`); its only external ref is the commit
  skill, which does not fire on a no-commit run. The delta between the two versions is exactly the
  **"Contracts & read economy"** subsection + the scoped "You read" line.

## How to run

Hand each arm's `_runner.md` to its own session (sequential; one variable per arm is already baked
in). Each: wipes `output/run-<LABEL>/`, copies `../_handoff-sandbox` → `workspace/`, stages the frozen
handoff → `tasks/HANDOFF.md`, spawns the general-purpose coder under the pinned skill, no commit,
isolation fence. Produced code lands under `output/run-<LABEL>/workspace/graph-service/`.

## What to measure

Diff the two coders' telemetry exactly as in the round-2 handoff benchmark — usage-ndjson under
`~/.radorc/telemetry/usage/`, **dedup by `pointers.requestId`**, subagent rows only (`agentType`,
`agentId`). Do NOT trust the transcript `tokens` field (double-counts ~1.87×). Signals that prove
the win:

- **distinct files read** and **engine files (`lib/graph-engine`) read** — Arm B should stay low /
  near-zero (no source sweep); Arm A should sweep to resolve the dangling types.
- **cache-read, turns, peak/mean context** — Arm B well below Arm A.
- **Quality gate:** both green (`tsc --noEmit` clean, tests pass), identical 7 routes + 11-primitive
  steer allowlist, barrel-only imports (no `lib/graph-engine` path imports).

**Baseline to beat (round-2 hand-built handoff, coder subagent):** distinct files ~17, engine files
**0**, cache-read ~6.5M (−57% vs the named-contract original), peak context ~176K. If Arm B lands
near these off the **planner-generated** task, the loop is closed — the improved planner emits tasks
the improved skill executes as cheaply as our hand-patched handoff did.

## Confounds

- `general-purpose` has a broader toolset than the real `@coder` subagent → **absolute** numbers
  won't match production. Both arms use it identically, so the A/B **delta** is attributable.
- n=1 per arm. Both arms move task **and** skill together (end-to-end proof, not an isolation of
  either lever alone).

_See the project auto-memory `project-coder-token-diet-handoff-ab` for the full history (coder rounds,
planner phase, masterplan A/B) this stage completes._
