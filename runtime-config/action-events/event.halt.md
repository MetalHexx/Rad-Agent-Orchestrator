---
kind: event
name: halt
title: Halt
description: Emergency stop signal that terminates the pipeline immediately.
signal_payload: {}
---

Fires only as an emergency stop — for example, when the loop encounters a Category 3 or Category 4 error (see the orchestrator's error-handling guide). The pipeline halts immediately and no further actions fire.
