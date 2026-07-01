# prompt-tests/

Operator-driven regression harness for planner subagent outputs and the planning-tier pipeline glue.

Planner output is non-deterministic by design: small prompt tweaks or skill-workflow edits can shift structure without regressing any structural test. Unit tests catch engine bugs. This harness catches **planner behavioral drift** — the kind that only shows up end-to-end against a real fixture.

The harness sits at the repo root (sibling to `docs/`, `installer/`, `ui/`, `.claude/`) by design. It does not load on every Claude session, has no CI integration, and is not part of the `.claude/` skill tree. Operators run it on demand.

## Behaviors

| Folder | What it exercises |
|--------|-------------------|
| [`extra-high-pipeline-e2e/`](./extra-high-pipeline-e2e/) | `extra-high.yml` planning chain end-to-end — Requirements → Master Plan → explosion script. Halts at `plan_approval_gate`. |
| [`low-pipeline-e2e/`](./low-pipeline-e2e/) | `low.yml` planning chain end-to-end — Requirements → Master Plan → explosion script under `--template low`. Halts at `plan_approval_gate`. |
| [`coder-commit-e2e/`](./coder-commit-e2e/) | The coder's **self-commit** contract (PLANNING-OVERHAUL-3 — commit folded into `task_completed`). **Two modes:** *isolated* (`_runner.md`) drives `@coder` once with a hand-written spawn prompt against a **real sandbox git repo** under `output/`; *pipeline* (`_runner-pipeline.md`) drives the **real `radorch.mjs` engine** through the execution/commit tier against `~/.radorc` (torn down after), so the engine composes the spawn prompt, the real explosion generates the handoff, and `task_completed` records the hash into `state.json`. Both assert the on-branch gate, explicit-path staging, `{prefix}(P01-T01): {title}` message, and the per-repo `{ committed, commitHash, pushed }` report for the side-project (no-remote) case → `pushed: false`. |
| [`rad-plan-benchmark/`](./rad-plan-benchmark/) | **Performance baseline** (not a regression alarm) — drives the real `/rad-plan` skill (menus and all) to `plan_approval_gate`. Captures spend via observability + commits full planning artifacts under versioned `output/run-N/` for cross-refactor comparison. |
| [`rad-master-plan-benchmark-v1/`](./rad-master-plan-benchmark-v1/) | **Performance baseline** for the **master-doc creation step** alone — seeds a pre-built **old FR/NFR/AD/DD ledger** Requirements doc, drives the real `/rad-plan` (post-PO-1: master plan + audit only) to `plan_approval_gate`. The old-world half of the V1/V2 old-vs-new master-plan pair. |
| [`rad-master-plan-benchmark-v2/`](./rad-master-plan-benchmark-v2/) | Same as V1 but seeds the **new requirement-grouped `R{n}`** Requirements doc — the native input for the post-PLANNING-OVERHAUL-2 master-plan skill. The new-world half of the pair; same `rainbow-hello` concept, so format is the only variable. |

## Running a behavior

1. Open a fresh Claude Code session at the repo root.
2. Paste the contents of `<behavior>/_runner.md` into the session as the kickoff prompt.
3. Pass the fixture name as input (default `rainbow-hello`).
4. Let the session drive the pipeline to its documented halt point and write the reports.

No runner executes on its own. The `_runner.md` file is authored as a prompt for a Claude session acting as a simulated orchestrator.

## Token cost — read before you loop

Each pass of `extra-high-pipeline-e2e` invokes `@planner` **twice** (Requirements, Master Plan). That is real Opus spend per run. Do not loop the harness for cosmetic verification. Re-run only when a planner prompt, skill workflow, or explosion-script change actually warrants a new baseline.

## Adding a new behavior

Mirror `extra-high-pipeline-e2e/`: a behavior folder with its own `README.md`, `_runner.md`, `fixtures/`, and `output/`. Keep `_runner.md` goal-oriented — describe what the simulated orchestrator session should accomplish, not every exact CLI invocation. The engine's `next_action` returns plus the Action Routing Table (`.claude/skills/rad-orchestration/references/action-event-reference.md`) handle the step-by-step decisions.

Run outputs under `output/` are gitignored per behavior — see the existing blocks in the repo-root `.gitignore` for the established pattern. Narrower `!` exceptions re-include operator-committed baselines; everything else regenerates on each run. Each new behavior needs its own gitignore entry.

## Design reference

Iteration design rationale lives at `docs/internals/cheaper-execution/iter-06-prompt-harness.md`. The harness is scope-locked there; broader architectural context for the refactor lives in `docs/internals/CHEAPER-EXECUTION-REFACTOR.md` and `CHEAPER-EXECUTION-REFACTOR-PROGRESS.md`.

## Tools

- `tools/lint-requirements.mjs` — structural linter for `{PROJECT}-REQUIREMENTS.md` docs
- `tools/lint-master-plan.mjs` — structural linter for `{PROJECT}-MASTER-PLAN.md` docs, with cross-reference against the companion requirements doc

Both are dependency-free Node `.mjs` scripts. Each supports `--self-test` mode against an in-memory malformed fixture to demonstrate actionable error messages.
