# Coder-Commit E2E — Runner Prompt (**isolated mode**)

> **Two modes.** This is the **isolated** runner — it hand-rolls a sandbox git repo under `output/`
> and hand-writes the coder spawn prompt to check the coder's commit *contract* in isolation. For the
> **real-pipeline** integration variant (engine-composed spawn prompt + real explosion + `state.json`
> hash recording, run against `~/.radorc` with teardown), see [`_runner-pipeline.md`](./_runner-pipeline.md).

> **Token cost.** This run invokes `@coder` **once** — real Opus-tier spend. The coder implements a
> tiny util AND commits it in a sandbox git repo. No reviewer / planner / orchestrator subagents are
> spawned; the only agent under test is the coder (its executor contract **plus** its new
> self-commit behavior).

---

## Mission

You are simulating the orchestrator at the `execute_task` step, at the moment a coding task is
dispatched **with a commit directive** (`should_commit: true`). PLANNING-OVERHAUL-3 folded
commit + push into the coder's `task_completed` — this harness verifies that contract for the
**side-project (no-remote)** case: the coder implements the task, commits its own work on the task
branch, does **not** push (there is no `origin`), and reports its per-repo
`{ name, committed, commitHash, pushed }` row plus the branch it committed on.

You initialize a throwaway sandbox git repo under `output/`, drive the coder against a handoff, then
assert the commit/push contract against real git state. You do **not** drive `radorch pipeline
signal` — the harness is the only invoker; no `state.json` exists and none is needed. The coder
reads only the handoff.

---

## Inputs

| Input | Value | Notes |
|-------|-------|-------|
| Fixture name | `solo-commit` | `prompt-tests/coder-commit-e2e/fixtures/solo-commit/` |
| Run folder | `prompt-tests/coder-commit-e2e/output/solo-commit/baseline-solo-commit-<YYYY-MM-DD>/` | Use today's date. The folder name must start with `baseline-` for the `.gitignore` exception to re-include `run-notes.md`. |
| Task branch | `feature/slugify` | The sandbox is pre-checked-out here; the coder's on-branch gate requires it. |

All paths are relative to the repo root unless noted.

---

## Setup

1. Choose a run-folder name: `baseline-solo-commit-<YYYY-MM-DD>`.
2. Create the run folder and copy the fixture's `tasks/` and `workspace/` into it:
   ```
   <run>/tasks/SOLO-COMMIT-TASK-P01-T01-SLUGIFY.md    # the handoff — lives OUTSIDE the sandbox repo
   <run>/workspace/                                    # becomes the sandbox git repo
   ```
   Copy the entire contents of `fixtures/solo-commit/` preserving structure (`tasks/`, `workspace/`,
   `workspace/src/`, `workspace/src/__tests__/`). The `package.json` sets `"type": "module"` so
   `node --test` treats the `.js` targets as ESM.

3. Initialize the sandbox git repo in `<run>/workspace`:
   ```
   git -C <run>/workspace init
   git -C <run>/workspace config user.email "harness@example.com"
   git -C <run>/workspace config user.name  "coder-commit-e2e harness"
   git -C <run>/workspace add -A
   git -C <run>/workspace commit -m "baseline"
   git -C <run>/workspace checkout -b feature/slugify
   ```

4. **Do NOT add an `origin` remote** — this is the side-project (no-remote) case. Confirm:
   `git -C <run>/workspace remote` prints nothing.

5. **Staging trap.** Create an untracked junk path the coder must NOT stage:
   ```
   <run>/workspace/node_modules/.trap/index.js       # any junk content; leave it untracked
   ```
   Do not `git add` it. It proves the coder stages explicit paths, not `git add -A` / `git add .`.

6. Record the two absolute paths you will pass to the coder:
   - `handoff_doc` = `<abs>/<run>/tasks/SOLO-COMMIT-TASK-P01-T01-SLUGIFY.md`
   - repo path    = `<abs>/<run>/workspace`

> The sandbox `.git` lives inside `output/`, which is gitignored, so it never pollutes the v3 repo.
> The coder never runs `git init` and never creates the branch — the harness does; the coder only
> commits on the branch it is handed. If the sandbox is not on `feature/slugify` before you spawn
> the coder, the coder's on-branch gate will (correctly) refuse to commit.

---

## Drive the coder

Spawn `@coder` (the `rad-execute-coding-task` skill) with a single spawn prompt that mirrors what
`runtime-config/action-events/action.execute_task.md` tells the orchestrator to inline. Pass:

1. The `handoff_doc` absolute path — the coder's **sole** doc input. Do not pass any Requirements /
   Master Plan / phase doc (none exist here anyway).

2. The `repos[]` array, inlined verbatim:
   ```
   repos:
     - name: solo-commit
       path: <abs>/<run>/workspace
       branch: feature/slugify
   ```

3. The **commit directive** — the natural-language rendering of `should_commit: true`:
   > "After implementing, commit your task's work following the `rad-source-control`
   > creating-commits reference; push if the worktree has an `origin` remote (this one does not).
   > Report your per-repo `{ name, committed, commitHash, pushed }` row and the branch you committed
   > on."

The coder should: read only the handoff; create `src/slugify.js` + `src/__tests__/slugify.test.js`;
run `node --test`; run its on-branch gate (`symbolic-ref --short -q HEAD` == `feature/slugify`);
stage its two files by explicit path; commit with a `{prefix}(P01-T01): {title}` message; probe for
an `origin` (find none); skip the push; and return its per-repo result row + branch.

Do **not** signal any pipeline event. Do **not** advance any state. After the coder returns, gather
git evidence.

---

## Gather evidence and write `run-notes.md`

Run these and capture verbatim output in `<run>/run-notes.md`:

```
git -C <run>/workspace symbolic-ref --short HEAD      # expect: feature/slugify
git -C <run>/workspace log --oneline                  # expect: baseline + exactly one new commit
git -C <run>/workspace log -1 --pretty=%s             # the commit subject
git -C <run>/workspace rev-parse --short HEAD         # the real hash
git -C <run>/workspace remote                         # expect: empty
git -C <run>/workspace show --stat --oneline HEAD     # expect: only src/slugify.js + src/__tests__/slugify.test.js
git -C <run>/workspace status --porcelain             # trap file still untracked
```

Also record: the coder's reported per-repo JSON row + branch (verbatim), the real `node --test`
output the coder captured, the exact list of files the coder read (confirm handoff-only), and the
files it created.

Then evaluate each pass criterion below and mark it green or red. If any red, **STOP** and surface to
the operator — never hide a red under a green report.

---

## Pass criteria — 8 checks

1. **On-branch commit.** `symbolic-ref --short HEAD` == `feature/slugify`, and a new commit exists on
   it — the gate was honored (not detached, not the base branch).
2. **Exactly one new commit** beyond `baseline` (`git log --oneline` shows 2 commits total).
3. **Message format.** The subject matches `^(feat|fix|refactor|test|docs|chore)\(P01-T01\): .+`
   (expected `chore(P01-T01): Slugify` — "Slugify" matches no prefix keyword, so the derivation
   falls to `chore`; any valid prefix from the set passes, but the `(P01-T01)` scope and format are
   mandatory).
4. **No-remote path.** The coder reported `pushed: false` **and** `git remote` is empty.
5. **Hash truth.** The reported `commitHash` equals `git rev-parse --short HEAD`.
6. **Staging discipline.** `git show --stat HEAD` lists **only** `src/slugify.js` +
   `src/__tests__/slugify.test.js` — no `node_modules`, no `.trap`, no unrelated paths.
7. **Report row well-formed.** `{ name: "solo-commit", committed: true, commitHash: <hash>,
   pushed: false }`, with the branch (`feature/slugify`) stated alongside the row.
8. **Engineering underneath.** `slugify` is a named ESM export satisfying the handoff's `Done when`
   cases (`slugify('Hello, World!') === 'hello-world'`, `slugify('  Foo   Bar  ') === 'foo-bar'`,
   no default export); the test was written and passes under real `node --test` (output captured) —
   the coder did the work, not just the commit.

If all eight are green, the run is a clean baseline. If any red, surface.

---

## Exit

Once `run-notes.md` is written, surface its path and the pass-criteria summary to the operator so
they can commit the baseline artifact.

**Do not drive `radorch pipeline signal` — the harness is the only invoker.** This harness is scoped
to the coder's commit/push contract for the **side-project (no-remote)** case. The push-to-remote
half is **Fixture B** — a standard worktree with a local bare `origin` (`git init --bare` a sibling,
set as `origin`, fully offline), which adds a `pushed: true` assertion and a check that the branch
landed on the bare remote. See the behavior [`README.md`](./README.md).
