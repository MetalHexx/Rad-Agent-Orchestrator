---
kind: action
name: spawn_phase_reviewer
title: Spawn phase reviewer
description: Spawn the reviewer agent for a phase-level conformance review.
category: agent-spawn
completion_event: phase_review_completed
---

Spawn the `reviewer` agent for phase-level review. Phase reviews always use `reviewer` (no junior tier).

The envelope carries `data.context.repos[]` — an array where each entry has `name`, `path`, `branch`, and the phase-scoped SHAs (`phase_first_sha` — the first task's initial commit, and `phase_head_sha` — the last task's latest commit, corrective-aware) for that repo. Inline the `repos[]` array verbatim into the reviewer spawn prompt so the reviewer reviews each repo's diff across the full phase range independently. When `source_control.auto_commit: never` or no commits have been made for a repo, that entry's SHAs are `null`; the reviewer falls back to `git diff HEAD` plus untracked files for that repo.

Inline `data.context.phase_plan_doc` — the phase plan the phase was executed against — so the reviewer reviews conformance against it. When `data.context.review_report_path` is present, inline it too. Both fields are emitted as absolute paths.

Extract the review doc path from the agent's final message.

The reviewer signals `phase_review_completed` with its verdict (`approved` | `changes_requested` | `rejected`) and `exit_criteria_met` on the review doc's frontmatter. Do not perform any mediation — the verdict routes the pipeline directly, and the coder self-mediates any corrective the engine births.
