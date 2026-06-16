---
kind: event
name: commit_completed
title: Commit completed
description: The source-control agent has finished the task's commit (and optionally a push) for all repos.
signal_payload:
  repos:
    required: true
    array: true
    description: Structured per-repo commit result array [{name, committed, commitHash, pushed}] returned by the CLI.
  phase:
    required: false
    description: Phase number. Auto-resolved from the active in-progress phase when omitted.
  task:
    required: false
    description: Task number. Auto-resolved from the active in-progress task when omitted.
---

Confirm the agent's `## Commit Result` array — each row carries `committed: true`, a non-empty `commitHash`, and a boolean `pushed`. Relay it unchanged: the mutation records a hash only when `committed` is true and silently skips any row missing it. Hashes match to task-iteration repos by name.

An off-branch / detached-HEAD escalation row is **not** a recordable result — it carries no `commitHash` and must not be signaled as a completed commit. Halt and surface it instead of recording-and-continuing.
