---
kind: event
name: pr_created
title: PR created
description: The PR-creation attempt has finished for all repos.
signal_payload:
  repos:
    required: true
    array: true
    description: Structured per-repo PR result array [{name, pr_url}] relayed from the PR step.
---

Confirm the PR step reported a per-repo result array `[{ name, pr_url }]`. Signaling writes each `pr_url` to the matching `source_control.repos[]` entry — a `null` `pr_url` means the PR was attempted but no URL is available.
