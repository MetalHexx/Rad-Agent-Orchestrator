---
kind: action
name: spawn_master_plan
title: Author the Master Plan inline
description: The main agent reads the approved requirements and authors the inlined phase + task Master Plan.
category: agent-spawn
completion_event: master_plan_completed
---

Read the project's approved Requirements doc and author the inlined phase + task Master Plan yourself, following `rad-create-plans` `master-plan` mode. The Master Plan is written to `{NAME}-MASTER-PLAN.md` in the project directory.