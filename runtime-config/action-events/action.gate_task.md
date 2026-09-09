---
kind: action
name: gate_task
title: Display task gate
description: Present the completed task results to the operator and wait for approval before the pipeline advances to the next task.
category: gate
completion_event: task_gate_approved
completion_when: The operator approves the task.
alternate_outcomes:
  - event: gate_rejected
    when: The operator rejects the task.
    values:
      gate-type: task
---

Show the operator the task's outcome: the code-review verdict, any corrective cycles applied, and the final state of the handoff. Give them enough context to judge whether the task is acceptable before the pipeline moves on.

Ask the operator to approve or reject. Hold here until they respond. If they reject, capture their reason verbatim.
