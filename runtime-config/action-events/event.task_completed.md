---
kind: event
name: task_completed
title: Task completed
description: The coder has finished executing the task — and, when commit was directed, committed its work.
signal_payload:
  phase:
    required: false
    description: Phase number. Auto-resolved from the active in-progress phase when omitted.
  task:
    required: false
    description: Task number. Auto-resolved from the active in-progress task when omitted.
  branch:
    required: false
    description: The branch the coder reported committing on.
  repos:
    required: false
    array: true
    item_keys: [name, committed, commitHash, pushed]
    description: Per-repo commit result array [{name, committed, commitHash, pushed}] returned by the coder.
---

Confirm the coder agent has returned and that any expected source / test edits and the optional `## Execution Notes` appendix are on disk.

When the task was directed to commit, relay the coder's per-repo result array unchanged. `committed: true` requires a non-empty `commitHash` and carries a boolean `pushed`; `committed: false` marks a repo that had nothing to commit. The mutation records each hash against the task iteration (matched by repo name), refuses a commit reported off its intended branch, and refuses to overwrite a finalized hash.

Recording happens before code review runs, so the reviewer's diff scope is anchored to the commit hash.
