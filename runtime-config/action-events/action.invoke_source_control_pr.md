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

Relay the resulting `[{ name, pr_url }]` array into one array-shaped `pr_created` signal via `--repos '<json>'`. Give every entry an explicit `pr_url`: the URL when creation succeeded, or `pr_url: null` when it failed or a pre-condition was unmet. The pipeline records each entry's `pr_url` as given (a `null` records the attempt as unavailable) and proceeds to the human gate.
