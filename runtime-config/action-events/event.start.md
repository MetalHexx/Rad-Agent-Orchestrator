---
kind: event
name: start
title: Start
description: Cold-start signal that loads state and resolves the next action without applying any mutation.
signal_payload: {}
---

Fires on the first call for a new project, when continuing an existing project, and on recovery after context compaction or agent restart. The pipeline loads `state.json`, skips mutation, and resolves the next action from the current state — so this event is always safe to send.
