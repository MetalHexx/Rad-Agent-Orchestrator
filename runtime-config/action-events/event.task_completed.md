---
kind: event
name: task_completed
title: Task completed
description: The coder has finished executing the task — and, when commit was directed, committed its work.
signal_payload:
  repos:
    required: false
    array: true
    description: Per-repo commit result array [{name, committed, commitHash, pushed}] returned by the coder. Present when the task was directed to commit (should_commit true); absent when commit was off.
  branch:
    required: false
    description: The branch the coder committed on. Checked against the intended task branch before any hash is recorded — a commit reported off-branch is refused.
  phase:
    required: false
    description: Phase number. Auto-resolved from the active in-progress phase when omitted.
  task:
    required: false
    description: Task number. Auto-resolved from the active in-progress task when omitted.
---

Confirm the coder agent has returned and that any expected source / test edits and the optional `## Execution Notes` appendix are on disk.

When the task was directed to commit, relay the coder's per-repo result array unchanged via `--repos '<json>'`, together with `--branch <branch>`. Each row carries `committed` — `true` with a non-empty `commitHash` and a boolean `pushed`, or `false` for a repo that had nothing to commit. The mutation records each hash against the task iteration (matched by repo name), refuses a commit reported off its intended branch, and refuses to overwrite a finalized hash. When commit was off, signal with no `repos` payload.

Recording happens before code review runs, so the reviewer's diff scope is anchored to the commit hash.
