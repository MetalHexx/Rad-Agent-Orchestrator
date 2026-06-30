---
kind: event
name: master_plan_completed
title: Master plan completed
description: The main agent has authored the project's master plan.
signal_payload:
  doc-path:
    required: true
    description: Path to the Master Plan doc authored by the main agent.
---

Confirm the master plan doc exists at the returned path before signaling. Signaling moves the pipeline into the explosion stage, which will parse this doc and emit per-phase and per-task work units.
