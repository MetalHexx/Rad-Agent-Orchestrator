# coder-commit-e2e

Prompt-harness regression for the coder's **self-commit** behavior introduced in
PLANNING-OVERHAUL-3 — commit + push were folded into the coder's `task_completed` (the coder "grew
into an engineer that commits its own work"), and the standalone source-control commit agent / CLI
`git commit` / `commit` event were removed. Unlike [`execute-coding-task-e2e/`](../execute-coding-task-e2e/),
which is deliberately git-isolated, this harness drives `@coder` **once**, WITH a commit directive
(`should_commit: true`), against a **real throwaway git repo** the runner initializes under
`output/`. The coder implements a tiny `slugify()` ESM util and commits it; the runner then asserts
the commit/push contract against real git state.

Both modes cover the **side-project (no-remote)** case — the commit lands locally and `pushed:
false`. The push-to-remote half (`pushed: true`, via a local bare `origin`) is **Fixture B**, the
documented follow-on. The PR node is out of scope.

## Modes

This behavior ships **two runners**, complementary — keep both.

| Mode | Runner | Repo location | What it exercises |
|------|--------|---------------|-------------------|
| **Isolated** | [`_runner.md`](./_runner.md) | sandbox git repo the runner inits under `output/` (gitignored) | The coder's **commit contract** in isolation: on-branch gate, explicit-path staging, conventional message `{prefix}(P01-T01): {title}`, push-only-if-remote, and the per-repo `{ name, committed, commitHash, pushed }` report. Fast, hermetic; the commit directive + `repos[]` are conveyed by a **hand-written** spawn prompt (mirroring `runtime-config/action-events/action.execute_task.md`), never written into the handoff. |
| **Pipeline** | [`_runner-pipeline.md`](./_runner-pipeline.md) | real `~/.radorc/side-projects/CODER-COMMIT-PIPE-E2E` (**torn down** after) | The **pipeline glue** PLANNING-OVERHAUL-3 rewrote: the **engine** composes the coder spawn prompt (`context-enrichment` builds `repos[]` + `should_commit`), the **real explosion** generates the handoff (no staleness risk), and the **`task_completed` mutation records the commit hash** into `state.json` (`assertReposOnBranch` enforced) before the pipeline advances cleanly to `spawn_final_reviewer`. Drives the real `radorch.mjs` engine end-to-end through the execution/commit tier. |

The isolated runner pre-checks-out the sandbox on the task branch because the coder's `symbolic-ref`
on-branch gate refuses to create or switch branches — it only commits on the branch it is handed. The
pipeline runner gets the branch (`main`) from the side-project seal, so no pre-checkout is needed.

> **Pipeline mode writes into the real `~/.radorc`** and tears it down afterward — read the Safety
> section of [`_runner-pipeline.md`](./_runner-pipeline.md) before running it.

## Fixtures

| Fixture | Mode | Shape |
|---------|------|-------|
| `solo-commit` | isolated | Tiny ESM string util. The coder creates `src/slugify.js` (a `slugify(str)` that lowercases / trims / hyphenates) plus a `node:test` suite, then commits both on the task branch `feature/slugify`. The sandbox has **no `origin`**, exercising the side-project path — the commit stays local and `pushed: false`. A staging trap (an untracked `node_modules/.trap/`) verifies the coder stages explicit paths, not `git add -A`. The handoff is hand-authored in the current explosion shape (`cli/src/lib/explode-master-plan.ts:558-616`), not the stale `tdd-slip` shape. |
| `pipeline-sideproject` | pipeline | A seeded `REQUIREMENTS.md` + `MASTER-PLAN.md` (side-project frontmatter, **1 phase / 1 task** = the same `slugify` util). Not a hand-written handoff — the real explosion generates it. The runner stages these into `~/.radorc/projects/CODER-COMMIT-PIPE-E2E`, drives the engine through plan-approval + `execute prepare` (which `git init -b main` + seals `auto_commit: always`, `remote_url: null`), spawns `@coder` via the engine's own `execute_task` prompt, and records the hash on `task_completed`. The Master Plan task block carries the coder's join key `**Files for CODER-COMMIT-PIPE-E2E:**` (not the template's singular `**Files**`). |

## Running

1. Open a fresh Claude Code session at the repo root.
2. Paste the contents of the runner for the mode you want:
   - **Isolated** → [`_runner.md`](./_runner.md), fixture `solo-commit`.
   - **Pipeline** → [`_runner-pipeline.md`](./_runner-pipeline.md), fixture `pipeline-sideproject`
     (writes into `~/.radorc`, tears down after — read its Safety section first).
3. Let the session drive `@coder`, gather evidence, and write the reports.

No runner executes on its own — each `_runner*.md` is authored as a prompt for a Claude session
acting as a simulated orchestrator.

## Token cost

Each pass invokes `@coder` **once** (real Opus-tier spend). No reviewer / planner / orchestrator
subagents are spawned — the only agent under test is the coder. Re-run only when a change to the
coder skill, the `rad-source-control` commit reference, or the `execute_task` spawn contract
warrants a new baseline.

## Output

Run outputs under `output/` are gitignored; a run folder named `baseline-<fixture>-<DATE>`
re-includes only its authored `run-notes.md` (see the `.gitignore` block for this behavior).

- **Isolated** (`solo-commit`): the nested sandbox `.git/` lives inside the gitignored `output/` tree
  and never pollutes the repo.
- **Pipeline** (`pipeline-sideproject`): the repo under test lives in `~/.radorc` and is **torn down**
  after the run — so `run-notes.md` (envelopes + `state.json` slice + git evidence, captured before
  teardown) is the only durable artifact. `output/pipeline-sideproject/baseline-pipeline-sideproject-2026-07-01/`
  currently holds a **placeholder** run-notes; replace it with a genuine run.
