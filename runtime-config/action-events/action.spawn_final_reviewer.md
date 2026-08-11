---
kind: action
name: spawn_final_reviewer
title: Spawn final reviewer
description: Spawn the reviewer agent for the final comprehensive project review.
category: agent-spawn
completion_event: final_review_completed
---

Spawn the `reviewer` agent for the final review. Final reviews always use `reviewer` (no junior tier).

The envelope carries `data.context.repos[]` — an array where each entry has `name`, `path`, `branch`, and the project-scoped SHAs (`project_base_sha` — the first chronological commit across the project, and `project_head_sha` — the last committed SHA including corrective commits at both task and phase scope) for that repo. Inline the `repos[]` array verbatim into the reviewer spawn prompt so the reviewer reviews each repo's full project diff independently. When `source_control.auto_commit: never` or no commits have been made for a repo, that entry's SHAs are `null`; the reviewer falls back to `git diff HEAD` plus untracked files for that repo.

Inline `data.context.requirements_doc` (the project requirements) and `data.context.phase_plan_paths` (the per-phase plans) so the reviewer reviews the project against its full contract; both are emitted as absolute paths. When `requirements_doc` is `null` pause the run and raise it to the human operator.

Extract the review doc path from the agent's final message.

The final reviewer is single-dispatch per review round. When the verdict is `changes_requested`, that verdict births a corrective on the review step; the corrective's coder re-adjudicates the running review report and produces updated dispositions, but the final reviewer is not re-dispatched within that round. If the operator instead rejects the work at the final-approval gate (`final_rejected`), that opens a fresh review round and legitimately re-fires this action. The orchestrator signals the verdict and performs no mediation.
