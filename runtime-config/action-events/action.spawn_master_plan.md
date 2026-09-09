---
kind: action
name: spawn_master_plan
title: Author the Master Plan inline
description: The main agent reads the approved requirements and authors the inlined phase + task Master Plan.
category: agent-spawn
completion_event: master_plan_completed
---

Before authoring, run `radorch.mjs session save` with `--project`, `--session`, `--harness`, `--cwd`, `--name`, `--type master-plan`, and a `--description` of what the conversation settled — the goals agreed and the open questions resolved, not the document about to be written. `--description` is 1–2 sentences, high-level — see rad-session's Save section. If the response carries a conflict, relay the message to the operator verbatim and do not retry against a different project.

Read the project's approved Requirements doc and author the inlined phase + task Master Plan yourself, following `rad-create-plans` `master-plan` mode. The Master Plan is written to `{NAME}-MASTER-PLAN.md` in the project directory.