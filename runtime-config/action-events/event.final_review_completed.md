---
kind: event
name: final_review_completed
title: Final review completed
description: The final project-level review has been finalized by the reviewer.
signal_payload:
  doc-path:
    required: true
    description: Path to the final review doc.
---

Confirm the review doc exists at the returned path and that its frontmatter carries a valid `verdict` (`approved` | `changes_requested` | `rejected`). Signaling commits the project to the reviewer's verdict — `approved` advances, `changes_requested` births a corrective on the review step, `rejected` halts, an unrecognized verdict halts, an exhausted budget halts, and a template snapshot with no declared corrective host halts rather than advancing.
