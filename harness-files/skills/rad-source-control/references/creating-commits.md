# Creating Commits

Commit your task's work when the spawn prompt directs you to. You commit in your own worktree, on your own task branch, with raw `git`.

**Batch your git calls.** Every shell call re-reads your whole context, and you commit at the end of a task when that context is largest — so a one-call-per-line commit ceremony is one of the most expensive things you do. Chain the git commands into as few calls as possible (`&&` one-liners below). The only call that must stand alone is the pre-commit branch gate (step 3): you have to read its output before deciding whether to commit at all.

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

Format the header as `{prefix}({taskId}): {title}`. Follow it with a blank line and 2–4 prose lines summarizing the change.  Follow conventional commit style.

## 2. Stage deliberately

Stage exactly your task's change — never secrets, build artifacts, `node_modules` or vendored deps, or unrelated files. Review what you are about to commit before you commit it.

## 3. Confirm you are on the intended branch (pre-commit gate)

Before committing, confirm the worktree HEAD is attached to your task branch:

    git -C "<path>" symbolic-ref --short -q HEAD

- Output equals the intended branch → proceed.
- Command fails (detached HEAD) or prints a different branch → **do not commit.** Stop and raise a Blocked report naming the observed vs. intended branch. A commit on the wrong branch is the one source-control mistake that is expensive to unwind — never guess past it.

## 4. Stage, commit, and verify — one chained call

Stage, commit, and confirm the result in a single call rather than four:

    git -C "<path>" add <paths> \
      && git -C "<path>" commit -m "<message>" \
      && git -C "<path>" rev-parse --short HEAD \
      && git -C "<path>" symbolic-ref --short -q HEAD

The last two lines echo your new commit hash and confirm HEAD is still attached to the branch. If HEAD is detached after the commit, or the branch did not advance, raise a Blocked report instead of reporting a normal result.

## 5. Push — only if the worktree has a remote

Push in one call, but skip cleanly when there is no remote — an absent `origin` must **exit zero** (an expected skip), not return a non-zero status that an agent could misread as a real failure and escalate:

    if git -C "<path>" remote get-url origin >/dev/null 2>&1; then
        git -C "<path>" push -u origin <branch>
    else
        echo "no origin remote — commit stays local (expected, not a failure)"
    fi

- Has an `origin` → the push runs. `-u` sets upstream on a new branch and is harmless on a branch already tracking its remote. A genuine push failure still exits non-zero, so a real problem is never masked.
- No `origin` (a side-project worktree) → the push is skipped with a message and a zero exit. That is expected, not a failure.

Never force-push and never rewrite history.

## 6. Report your result

Report your commit so the orchestrator can record it — one row per repo, plus the branch you committed on:

    { "name": "<repo>", "committed": true, "commitHash": "<hash>", "pushed": <true|false> }

- `commitHash` is **required** when `committed` is `true` — downstream review scopes its diff to it.
- `pushed` is `true` only if you pushed; `false` for a remote-less worktree.
- Nothing to commit (no changes in scope) → report `committed: false` with `commitHash: null`. That is a clean skip.

State the branch alongside the row; this is important to ensure a smooth process.
