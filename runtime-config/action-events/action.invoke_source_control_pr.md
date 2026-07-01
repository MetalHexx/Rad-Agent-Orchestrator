---
kind: action
name: invoke_source_control_pr
title: Invoke source control PR
description: Open a pull request for the completed project branch directly, following the PR reference.
category: source-control
completion_event: pr_created
---

Open the pull request(s) yourself — do not spawn an agent. Follow the `rad-source-control` PR reference (`working-with-prs.md`) for existing-PR detection, the body sourced from `state.final_review.doc_path`, and sibling cross-linking.

The envelope carries `data.context.repos[]` — an array where each entry has `name`, `path`, `branch`, and `base_branch`. For each repo, open one PR from `branch` against `base_branch`, running `gh` in that repo's `path`.

Relay the resulting `[{ name, pr_url }]` array into one array-shaped `pr_created` signal via `--repos '<json>'`. If a repo's `pr_url` is non-null, the signal carries the URL; if `pr_url` is `null` (creation failed or a pre-condition was unmet), omit that entry's URL so the pipeline records the attempt as `null` and proceeds to the human gate.
