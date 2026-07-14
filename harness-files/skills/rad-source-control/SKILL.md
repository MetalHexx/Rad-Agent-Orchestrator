---
name: rad-source-control
description: 'Use this skill if you are a main agent, coder agent and have this skill assigned.  It is the reference for how to perform source-control operations like creating commits, opening pull requests, and creating or cleaning up worktrees for a project.'
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
