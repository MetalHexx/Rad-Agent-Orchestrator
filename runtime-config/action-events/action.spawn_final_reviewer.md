---
kind: action
name: spawn_final_reviewer
title: Spawn final reviewer
description: Spawn the reviewer agent for the final comprehensive project review.
category: agent-spawn
completion_event: final_review_completed
---

Spawn the `reviewer` agent for the final review. Final reviews always use `reviewer` (no junior tier).

The envelope carries `data.context.repos[]` — an array where each entry has `name`, `path`, `branch`, and the project-scoped SHAs (`project_base_sha` — the earliest of the repo's accumulated project commits in that repo's own ancestry, and `project_head_sha` — the latest, including corrective commits at both task and phase scope) for that repo. Inline the `repos[]` array verbatim into the reviewer spawn prompt so the reviewer reviews each repo's full project diff independently. When `source_control.auto_commit: never` or no commits have been made for a repo, that entry's SHAs are `null`; the reviewer falls back to `git diff HEAD` plus untracked files for that repo. When `data.context` carries `error` instead of `repos[]`, pause the run and raise that message to the human operator verbatim rather than spawning the reviewer.

Inline `data.context.requirements_doc` (the project requirements) and `data.context.phase_plan_paths` (the per-phase plans) so the reviewer reviews the project against its full contract; both are emitted as absolute paths. When `requirements_doc` is `null` pause the run and raise it to the human operator.

Extract the review doc path from the agent's final message.

The final reviewer is single-dispatch: it fires once and is never re-dispatched. A `changes_requested` verdict births a corrective on the review step, and so does an operator change request at the final-approval gate (`final_corrective_requested`) — both are worked by the corrective's own child review re-adjudicating the running review report, never by re-firing this action. A rejection at the gate (`final_rejected`) halts the pipeline instead of birthing anything. The orchestrator signals the verdict and performs no mediation.
