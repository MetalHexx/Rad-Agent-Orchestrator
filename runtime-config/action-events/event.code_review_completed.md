---
kind: event
name: code_review_completed
title: Code review completed
description: A task-level code review has been finalized by the reviewer.
signal_payload:
  doc-path:
    required: true
    description: Path to the code review doc.
---

Confirm the review doc exists at the returned path and that its frontmatter carries a valid `verdict` (`approved` | `changes_requested` | `rejected`). Signaling commits the task loop to the reviewer's verdict — `changes_requested` births a corrective, `rejected` halts, `approved` advances.
