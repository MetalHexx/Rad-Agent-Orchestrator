# Coder-Commit E2E — Pipeline mode — baseline run notes

- **Date:** 2026-07-01
- **Mode:** pipeline (drives the real `radorch.mjs` engine end-to-end through the execution/commit tier)
- **Fixture:** `pipeline-sideproject` (`REQUIREMENTS.md` + `MASTER-PLAN.md`, one R1 → one P01-T01)
- **Tier:** `low` (`task_loop = [task_executor]`; halts at `spawn_final_reviewer`)
- **Project / repo name:** `CODER-COMMIT-PIPE-E2E`
- **`DIR`:** `~/.radorc/projects/CODER-COMMIT-PIPE-E2E` (torn down)
- **`SIDEREPO`:** `~/.radorc/side-projects/CODER-COMMIT-PIPE-E2E` (torn down)
- **Live subagent:** one `coder-junior` (routing: `simple` → `coder-junior`). No planner/reviewer spawned.
- **Machine gate policy:** `orchestration.yml` `human_gates.execution_mode: autonomous` → no `ask_gate_mode`; `execute_task` resolved directly. No `gate_mode_set` step inserted.

> The `$SIDEREPO` git repo is intentionally deleted at teardown. These notes ARE the durable artifact.

---

## Result: **8 / 8 GREEN — clean baseline**

| # | Criterion | Verdict |
|---|---|---|
| 1 | Real explosion → current-shape handoff | ✅ |
| 2 | Engine composed the coder spawn prompt | ✅ |
| 3 | On-branch commit on `main` | ✅ |
| 4 | Conventional-Commits message format | ✅ |
| 5 | No-remote path (`pushed:false`, empty remote) | ✅ |
| 6 | `task_completed` recorded the hash (core PO-3 glue) | ✅ |
| 7 | Pipeline advanced to `spawn_final_reviewer` | ✅ |
| 8 | Staging discipline + engineering (2 files, named export, tests pass) | ✅ |

---

## Signal trace (the driven engine path)

| Step | Event signalled | Returned action |
|---|---|---|
| 1 | `start --template low` | `spawn_master_plan` |
| 2 | `master_plan_completed --doc-path CODER-COMMIT-PIPE-E2E-MASTER-PLAN.md` | `explode_master_plan` |
| 3 | `plan explode` (subcommand, no agent) | `{emittedPhases:1, emittedTasks:1, backupDir:null}` exit 0 |
| 4 | `explosion_completed` | `request_plan_approval` |
| 5 | `execute prepare --project CODER-COMMIT-PIPE-E2E` | side-project init (branch `main`, seed `5437c52`), source_control sealed, `plan_approved` → `execute_task` |
| 6 | `start` (re-poll) | `execute_task` |
| 7 | *(spawn `coder-junior`, execute handoff)* | coder returns commit `c657cee` |
| 8 | `task_completed --repos … --branch main --phase 1 --task 1` | **`spawn_final_reviewer`** (HALT) |

---

## Criterion #1 — generated handoff (current shape)

`DIR/tasks/CODER-COMMIT-PIPE-E2E-TASK-P01-T01-SLUGIFY.md` frontmatter:

```yaml
project: CODER-COMMIT-PIPE-E2E
phase: 1
task: 1
title: Slugify
status: pending
complexity: simple
repos:
  - CODER-COMMIT-PIPE-E2E
created: '2026-07-01T15:55:59.394Z'
type: task_handoff
```

Body carried the `**Files for CODER-COMMIT-PIPE-E2E:**` section:
- Create: `src/slugify.js` (the pure `slugify()` ESM module).
- Create: `src/__tests__/slugify.test.js` (a `node:test` suite for it).

Handoff was produced by the **real explosion** (no hand-authoring → no staleness).

---

## Criterion #2 — engine-composed `execute_task` envelope (verbatim `data`)

```json
{
  "action": "execute_task",
  "context": {
    "phase_number": 1,
    "phase_id": "P01",
    "task_number": 1,
    "task_id": "P01-T01",
    "handoff_doc": "tasks/CODER-COMMIT-PIPE-E2E-TASK-P01-T01-SLUGIFY.md",
    "repos": [
      {
        "name": "CODER-COMMIT-PIPE-E2E",
        "path": "C:\\Users\\Metal\\.radorc\\side-projects\\CODER-COMMIT-PIPE-E2E",
        "branch": "main"
      }
    ],
    "complexity": "simple",
    "should_commit": true
  },
  "completion_event": "task_completed"
}
```

The engine (not the runner) built `context.repos[]`, `should_commit: true`, and `handoff_doc`.

---

## Criterion #3, #4, #5 — commit evidence (`$SIDEREPO`, captured pre-teardown)

```
$ git symbolic-ref --short HEAD
main

$ git log --oneline
c657cee feat(P01-T01): add slugify function with tests
5437c52 chore: initialize side-project

$ git log -1 --pretty=%s
feat(P01-T01): add slugify function with tests

$ git rev-parse --short HEAD
c657cee

$ git remote
(empty)

$ git show --stat --oneline HEAD
c657cee feat(P01-T01): add slugify function with tests
 src/__tests__/slugify.test.js | 23 +++++++++++++++++++++++
 src/slugify.js                |  7 +++++++
 2 files changed, 30 insertions(+)
```

- #3 on-branch: HEAD == `main`, exactly one new commit beyond the seed; on-branch gate honored.
- #4 subject matches `^(feat|fix|refactor|test|docs|chore)\(P01-T01\): .+`.
- #5 no-remote: coder reported `pushed:false` **and** `git remote` is empty.

Coder's reported per-repo row + branch:

```json
[{ "name": "CODER-COMMIT-PIPE-E2E", "committed": true, "commitHash": "c657cee", "pushed": false }]
```
branch: `main`

---

## Criterion #6 — `task_completed` recorded the hash (the core PO-3 glue)

`state.json` `graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].repos[0]`:

```json
{ "name": "CODER-COMMIT-PIPE-E2E", "commit_hash": "c657cee" }
```

`state.project.project_type = "side-project"`.

Three-way match: recorded `commit_hash` **c657cee** == `git rev-parse --short HEAD` **c657cee** == coder-reported **c657cee**. ✅
The post-`task_completed` envelope also echoed `project_base_sha == project_head_sha == c657cee`, and `assertReposOnBranch` accepted the on-`main` commit.

---

## Criterion #7 — pipeline advanced correctly

Post-`task_completed` envelope `data.action` = **`spawn_final_reviewer`**. Clean halt; reviewer NOT spawned (LOW-tier halt point).

---

## Criterion #8 — staging discipline + engineering

Commit contains **only** `src/slugify.js` + `src/__tests__/slugify.test.js` (2 files, +30 lines).

`src/slugify.js` — named ESM export, no default:

```js
export function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

- `slugify('Hello, World!')` → `'hello-world'` ✅
- `slugify('  Foo   Bar  ')` → `'foo-bar'` ✅
- named export only; `slugifyModule.default === undefined` asserted ✅

### Independent `node --test` re-run (not the coder's capture)

```
▶ slugify
  ✔ converts "Hello, World!" to "hello-world"
  ✔ converts "  Foo   Bar  " to "foo-bar"
  ✔ strips leading and trailing separators
  ✔ has no default export
✔ slugify
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 88.0673
```

exit 0. (The coder's own captured run reported the same 5/5.)

---

## Teardown

Both real `~/.radorc` dirs removed after evidence capture:
- `~/.radorc/projects/CODER-COMMIT-PIPE-E2E`
- `~/.radorc/side-projects/CODER-COMMIT-PIPE-E2E`

`~/.radorc/.gitignore` left untouched. Side-projects are discovered by directory scan (no registry/install.json entry), so the two `rm -rf`s fully de-register the run. Confirmed both dirs gone post-teardown.
