---
kind: event
name: phase_review_completed
title: Phase review completed
description: A phase-level review has been finalized by the reviewer.
signal_payload:
  doc-path:
    required: true
    description: Path to the phase review doc.
---

Confirm the review doc exists at the returned path and that its frontmatter carries a valid `verdict` (`approved` | `changes_requested` | `rejected`) and `exit_criteria_met`. Signaling commits the phase loop to the reviewer's verdict — `changes_requested` births a corrective, `rejected` halts, `approved` advances.
