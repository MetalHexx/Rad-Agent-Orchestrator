---
kind: action
name: request_plan_approval
title: Display plan approval gate
description: Present the completed Master Plan to the operator and wait for approval before the pipeline proceeds to execution.
category: gate
completion_event: plan_approved
---

Present the Master Plan to the operator. Show the phase breakdown and task list so they can verify scope and sequencing before any code is written.

Ask the operator to approve or reject. Hold here until they respond — do not proceed autonomously regardless of gate-mode settings or auto-approval configuration.

If they approve, invoke the `/rad-execute` skill which will run the user through the execution steps.  If they reject, invoke `/rad-brainstorm` to continue refinement.