---
kind: action
name: spawn_code_reviewer
title: Spawn code reviewer
description: Spawn the reviewer agent for a task-level code review.
category: agent-spawn
completion_event: code_review_completed
---

Spawn the reviewer agent for task-level code review. Select the tier from the task's complexity, carried on the envelope as `data.context.complexity` (`simple` | `standard` | `complex`): `simple` → `rad-orc:reviewer-junior`; `standard` or `complex` → `rad-orc:reviewer`.

The envelope carries `data.context.repos[]` — an array where each entry has `name`, `path`, `branch`, and the task-scoped commit SHA (`head_sha`) for that repo. Inline the `repos[]` array verbatim into the reviewer spawn prompt so the reviewer resolves each repo's diff independently using the per-repo `head_sha` and `path`. When `source_control.auto_commit: never` or no commit has been made for a repo, that entry's `head_sha` is `null`; the reviewer falls back to `git diff HEAD` plus untracked files for that repo.

Inline `data.context.handoff_doc` — the original scope doc (task handoff) the coder implemented against — so the reviewer reviews the diff against the same contract. When `data.context.review_report_path` is present (a re-review of a correction), inline it too so the reviewer sees the report that requested the prior changes. Both fields are emitted as absolute paths.

Extract the review doc path from the agent's final message.

The reviewer signals `code_review_completed` with its verdict (`approved` | `changes_requested` | `rejected`) on the review doc's frontmatter. Do not perform any mediation — the verdict routes the pipeline directly, and the coder self-mediates any corrective the engine births.
