---
kind: event
name: gate_rejected
title: Gate rejected
description: The operator has rejected either a task gate or a phase gate; the pipeline must route into a corrective cycle.
signal_payload:
  gate-type:
    required: true
    description: Which gate the operator rejected — `task` or `phase`.
  reason:
    required: true
    description: Brief operator-supplied reason. Drives the corrective cycle's framing.
---

Fires only on an explicit operator decline of a task gate or a phase gate. Capture the operator's reason verbatim so the corrective handoff downstream can frame the cycle around their concern; the `gate-type` field tells the orchestrator whether to route into a task-scope or phase-scope corrective cycle.
