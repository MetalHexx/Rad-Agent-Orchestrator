---
kind: action
name: ask_gate_mode
title: Ask gate mode
description: Present the gate-mode options to the operator and capture their selection before pipeline execution proceeds.
category: gate
completion_event: gate_mode_set
---

Present the three gate-mode options to the operator: `task` (pause at every task), `phase` (pause at every phase), and `autonomous` (no pauses between tasks or phases — only at the master-plan and final-review gates). Hold here until they pick one.

Do not infer or default a value on ambiguous input — the recorded mode must be the operator's exact selection.
