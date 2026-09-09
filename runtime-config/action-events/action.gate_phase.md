---
kind: action
name: gate_phase
title: Display phase gate
description: Present the completed phase results to the operator and wait for approval before the pipeline advances to the next phase.
category: gate
completion_event: phase_gate_approved
completion_when: The operator approves the phase.
alternate_outcomes:
  - event: gate_rejected
    when: The operator rejects the phase.
    values:
      gate-type: phase
---

Show the operator the phase review summary: exit-criteria assessment, cumulative diff scope, and any issues or carry-forward items noted by the reviewer. Give them sufficient context to judge whether the phase meets the bar before the pipeline moves on.

Ask the operator to approve or reject. Hold here until they respond. If they reject, capture their reason verbatim.
