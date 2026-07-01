---
kind: event
name: pr_requested
title: PR requested
description: Internal validation checkpoint signaled after final review when auto-PR is enabled and no PR has been attempted yet.
signal_payload: {}
---

Signal `pr_requested` internally after `final_review_completed` when `pipeline.source_control.auto_pr: always` and no `repos[]` entry has a `pr_url` yet (not attempted). A `repos[]` entry whose `pr_url` is `null` means PR creation was already attempted but no URL is available; that entry must not re-trigger `pr_requested`. The event serves as the validation checkpoint before the orchestrator opens the PR(s) directly.
