---
kind: event
name: plan_rejected
title: Plan rejected
description: The operator has rejected the Master Plan and the pipeline must route back for revision.
signal_payload: {}
---

Signal `plan_rejected` only when the operator explicitly declined the Master Plan. The pipeline routes back so the plan can be revised.
