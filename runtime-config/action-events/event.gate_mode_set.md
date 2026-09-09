---
kind: event
name: gate_mode_set
title: Gate mode set
description: The operator has selected the gate mode and the pipeline can proceed under that policy.
signal_payload:
  gate-mode:
    required: true
    description: Selected gate mode — one of `task`, `phase`, or `autonomous`.
---

Fires only after the operator has explicitly picked one of the three modes — never infer a value on ambiguous input. The selected mode determines whether per-task and per-phase gates pause for human approval downstream.
