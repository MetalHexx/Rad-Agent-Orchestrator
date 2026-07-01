# Creating Commits

Commit your task's work when the spawn prompt directs you to. You commit in your own worktree, on your own task branch, with raw `git`.

## 1. Build the commit message

Derive the prefix from the task's title or type (first keyword match):

| Keywords | Prefix |
|----------|--------|
| feature, feat, new | `feat` |
| fix, bug, patch | `fix` |
| refactor, restructure, clean | `refactor` |
| test, testing, spec | `test` |
| doc, docs, documentation | `docs` |
| *(no match)* | `chore` |

Format the header as `{prefix}({taskId}): {title}`. Optionally follow it with a blank line and 2–4 prose lines summarizing the change.  Follow conventional commit style.

## 2. Stage deliberately

Stage exactly your task's change — never secrets, build artifacts, `node_modules` or vendored deps, or unrelated files. Review what you are about to commit before you commit it.

## 3. Confirm you are on the intended branch (pre-commit gate)

Before committing, confirm the worktree HEAD is attached to your task branch:

    git -C "<path>" symbolic-ref --short -q HEAD

- Output equals the intended branch → proceed.
- Command fails (detached HEAD) or prints a different branch → **do not commit.** Stop and raise a Blocked report naming the observed vs. intended branch. A commit on the wrong branch is the one source-control mistake that is expensive to unwind — never guess past it.

## 4. Commit

    git -C "<path>" add <paths>
    git -C "<path>" commit -m "<message>"

Then confirm the branch advanced and HEAD is still attached:

    git -C "<path>" rev-parse --short HEAD          # your new commit
    git -C "<path>" symbolic-ref --short -q HEAD    # still the intended branch

If HEAD is detached after the commit, or the branch did not advance, raise a Blocked report instead of reporting a normal result.

## 5. Push — only if the worktree has a remote

Check for an `origin` remote:

    git -C "<path>" remote get-url origin

- Has an `origin` → push. On the first push of a new branch, set upstream; afterward a plain push suffices:

      git -C "<path>" push -u origin <branch>       # first push of this branch
      git -C "<path>" push                           # subsequent pushes

- No `origin` (a side-project worktree) → skip the push. The commit stays local; that is expected, not a failure.

Never force-push and never rewrite history.

## 6. Report your result

Report your commit so the orchestrator can record it — one row per repo, plus the branch you committed on:

    { "name": "<repo>", "committed": true, "commitHash": "<hash>", "pushed": <true|false> }

- `commitHash` is **required** when `committed` is `true` — downstream review scopes its diff to it.
- `pushed` is `true` only if you pushed; `false` for a remote-less worktree.
- Nothing to commit (no changes in scope) → report `committed: false` with `commitHash: null`. That is a clean skip.

State the branch alongside the row; this is important to ensure a smooth process.
