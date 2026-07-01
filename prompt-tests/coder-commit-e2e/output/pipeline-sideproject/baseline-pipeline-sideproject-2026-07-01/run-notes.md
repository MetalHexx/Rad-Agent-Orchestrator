# run-notes — baseline-pipeline-sideproject-2026-07-01 (PLACEHOLDER)

> **Placeholder baseline — not yet a real run.** This file reserves the committed-baseline slot for
> **pipeline mode** so the `.gitignore` re-include and the folder convention are in place. Replace it
> with a genuine run by pasting [`../../../_runner-pipeline.md`](../../../_runner-pipeline.md) into a
> fresh Claude Code session at the repo root and letting it drive the real pipeline through the
> execution/commit tier, then teardown. See the isolated-mode baseline
> ([`../../solo-commit/baseline-solo-commit-2026-07-01/run-notes.md`](../../solo-commit/baseline-solo-commit-2026-07-01/run-notes.md))
> for the shape a completed run-notes takes.

## What a real pipeline-mode run records here

Unlike the isolated mode (which hand-rolls a sandbox repo under `output/`), pipeline mode drives the
**real `radorch.mjs` engine** against the real `~/.radorc`, then tears it down. The repo it exercises
(`~/.radorc/side-projects/CODER-COMMIT-PIPE-E2E`) is **gone** after the run — so these notes are the
only durable evidence. A completed run captures, verbatim:

- **The `execute_task` envelope** — `data.context.repos` (path = the side-project repo, branch =
  `main`), `data.context.should_commit: true`, and `handoff_doc`. Proof the **engine composed** the
  coder spawn prompt (criterion #2).
- **The generated handoff** — `DIR/tasks/CODER-COMMIT-PIPE-E2E-TASK-P01-T01-SLUGIFY.md` frontmatter
  (`type: task_handoff`, `complexity: simple`, `repos: ["CODER-COMMIT-PIPE-E2E"]`) + its
  `**Files for CODER-COMMIT-PIPE-E2E:**` section. Proof the **real explosion** produced a
  current-shape handoff — no hand-authoring (criterion #1).
- **The coder's per-repo row** — `[{ name: "CODER-COMMIT-PIPE-E2E", committed: true, commitHash:
  "<sha>", pushed: false }]` + branch `main`, and the `node --test` output.
- **`$SIDEREPO` git evidence** (captured before teardown) — `symbolic-ref --short HEAD` == `main`;
  `log --oneline` = seed + one new commit; `rev-parse --short HEAD`; empty `remote`; `show --stat
  HEAD` = only `src/slugify.js` + `src/__tests__/slugify.test.js`.
- **The recorded hash from `state.json`** —
  `state.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].repos[0].commit_hash`,
  equal to `rev-parse --short HEAD` and the coder's reported hash. **The core PLANNING-OVERHAUL-3
  glue** (criterion #6).
- **The post-`task_completed` envelope** — `data.action` == `spawn_final_reviewer` (clean LOW-tier
  halt; no reviewer spawned) (criterion #7).
- **Teardown confirmation** — both `~/.radorc/{projects,side-projects}/CODER-COMMIT-PIPE-E2E` removed.

## Pass criteria — 8 checks (see `_runner-pipeline.md` for the authoritative list)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Real explosion produced a current-shape handoff (`type: task_handoff`, `**Files for …:**`) | ⚪ not yet run |
| 2 | Engine composed the spawn prompt (`should_commit: true`, `repos[].path` = side-project, `handoff_doc`) | ⚪ not yet run |
| 3 | On-branch commit on `main`; exactly one new commit beyond the seed | ⚪ not yet run |
| 4 | Message format `^(feat\|fix\|refactor\|test\|docs\|chore)\(P01-T01\): .+` | ⚪ not yet run |
| 5 | No-remote path — `pushed: false` **and** empty `git remote` | ⚪ not yet run |
| 6 | `task_completed` recorded the hash in `state.json` (== repo HEAD == reported hash) | ⚪ not yet run |
| 7 | Pipeline advanced to `spawn_final_reviewer` (clean halt) | ⚪ not yet run |
| 8 | Staging discipline + engineering (only the two files; named ESM export; suite passes) | ⚪ not yet run |
