---
name: rad-source-control
description: 'Source control operations for the rad orchestration pipeline — commit your task''s work (coding agent), open the project pull request (main session), or create and clean up a worktree (main session). Each operation routes to its own reference.'
user-invocable: false
---

# Source Control

This skill is a router. Each source-control operation has one reader and one reference. Read the section for your operation and follow it.

## Routing Table

| Operation | Reader | Reference |
|-----------|--------|-----------|
| Commit your task's work | coding agent | [`references/creating-commits.md`](references/creating-commits.md) |
| Open the project PR | main session | [`references/working-with-prs.md`](references/working-with-prs.md) |
| Create a worktree | main session | [`references/working-with-worktrees.md`](references/working-with-worktrees.md) |
| Clean up a worktree | main session | [`references/working-with-worktrees.md`](references/working-with-worktrees.md) |

## Envelope convention

Worktree operations call the `radorch` CLI, which emits a single JSON envelope on stdout:

```
{ "ok": <bool>, "data": { ... }, "error": { ... } }
```

Read result fields from inside `data`. Commit runs on raw `git` and PR runs on `gh` — those references describe their own outputs.
