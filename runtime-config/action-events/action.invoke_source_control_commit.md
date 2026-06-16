---
kind: action
name: invoke_source_control_commit
title: Invoke source control commit
description: Spawn the source-control agent to commit (and optionally push) the task's working changes.
category: source-control
completion_event: commit_completed
---

Spawn `rad-orc:source-control` in commit mode.

Inline `data.context.repos[]` (each `{name, path, branch}`) verbatim into the spawn prompt with the task title and type. The agent writes one commit message per repo and runs `radorch git commit --repos '<json>'`.

Relay the agent's result array into the signal **verbatim** — pass every field of each row through unchanged (`name`, `committed`, `commitHash`, `pushed`). Do not reconstruct or drop fields: `committed` is what records the hash.

If the agent returns an **off-branch escalation** for any repo (a detached-HEAD or wrong-branch report) in place of a normal commit row, treat it as a halt-worthy escalation: stop, surface the repo(s) by name, and do **not** record it as a commit or signal `commit_completed` for that repo.
