---
name: rad-source-control
description: 'Source control operations — commit code, open a PR, create a worktree, or clean up a worktree. All inputs for commit and PR come from the spawn prompt; worktree operations are interactive and driven from the main session.'
user-invocable: false
---

# Source Control

This skill is a router. Each operation dispatches to a reference document. Read the section for your operation and follow it.

---

## Fan-out model

Commit and PR operations work across one or more repos in a single CLI call. The agent composes one commit message or PR description per repo, then passes the full array to the CLI via `--repos '<json>'`. No additional agent tool calls are needed — the CLI handles all repos in one pass and returns a structured per-repo result.

**Failure semantics:**

- **Commit failure** — if a repo's commit fails, halt immediately and name the failing repo. Do not continue to remaining repos.
- **Push failure** — if push fails for a repo, mark that repo as `pushed: false` and continue. The commit itself is still a success.
- **No-change repo** — a repo with no staged changes is a clean skip (`committed: false`). Relay it as-is; the pipeline ignores it without error.
- **Off-branch / detached HEAD** — if a repo's HEAD is not attached to its intended branch before commit, or the branch ref did not advance after commit, do not relay a commit row: emit the off-branch escalation and halt. Distinct from a benign remote-less `pushed:false` and a benign no-change `committed:false` skip.

The agent runs on the haiku model. All inputs (repo names, paths, branch names, messages, PR descriptions) come from the spawn prompt — no interactive prompting.

---

## Shared JSON-Envelope Convention

All `radorch` CLI calls emit a single JSON envelope on stdout:

```
{ "ok": <bool>, "data": { ... }, "error": { ... } }
```

Read result fields from inside `data` and emit the corresponding markdown block. This convention applies to every operation below.

---

## Routing Table

| Operation | Invoker | All inputs from spawn prompt? | Reference |
|-----------|---------|-------------------------------|-----------|
| Commit | source-control subagent | true | [`references/creating-commits.md`](references/creating-commits.md) |
| Open PR | source-control subagent | true | [`references/working-with-prs.md`](references/working-with-prs.md) |
| Create worktree | main session | false (interactive + project state) | [`references/working-with-worktrees.md`](references/working-with-worktrees.md) |
| Clean up worktree | main session | false (interactive + project state) | [`references/working-with-worktrees.md`](references/working-with-worktrees.md) |

> **Triad note:** Worktree lifecycle (create and clean up) lives in the **act lane** of the orchestration triad. Commit and PR remain subagent operations and are never reached by the interactive worktree flow.
