---
kind: event
name: final_rejected
title: Final approval gate rejected
description: The operator has rejected the final review and the pipeline halts.
signal_payload:
  reason:
    required: true
    description: The operator's reason for rejecting, verbatim. Becomes the pipeline's halt reason.
---

Fires only when the operator declines the project outright at the final approval gate. The pipeline halts with their reason on record and nothing is re-run — no reviewer is re-dispatched and no corrective is born. Reach for `final_corrective_requested` instead when the operator wants changes rather than an end; rejection is the exit, not a route back.
