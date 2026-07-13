---
kind: action
name: execute_task
title: Execute task
description: Spawn the right-sized coder agent, based on task complexity, to implement the task described in the pre-seeded handoff document — and, when directed, commit its work.
category: agent-spawn
completion_event: task_completed
---

Spawn the right-sized coder agent for this task — choose the tier from the task's complexity, carried on the envelope as `data.context.complexity` (`simple` | `standard` | `complex`). The handoff document path is carried on the envelope as `handoff_doc`, an absolute path that the coder inlines verbatim; it is the coder's sole doc-path input.

The envelope also carries `data.context.repos[]` — an array where each entry has `name`, `path`, and `branch`. Inline the `repos[]` array verbatim into the coder spawn prompt. The coder joins each handoff's `**Files for <repo>:**` section against the matching `repos[N].path` to resolve absolute file targets.

The envelope carries `data.context.should_commit`. When `true`, instruct the coder to commit its work after implementation — and push when the repo has a remote. When `false`, the coder leaves its changes uncommitted (the reviewer diffs the working tree). Pass the directive into the coder's spawn prompt; do not commit yourself.

When `data.context.corrective_index` is present this spawn is a correction. Pass the same `handoff_doc` (the original scope doc — corrections re-run against the original contract) plus `data.context.review_report_path` so the coder reads the review that requested the change. Escalate the coder tier by `corrective_index` (budget-relative: higher index → escalate toward `coder` / `coder-senior` - break-glass), per the pipeline guide's coder-tier policy. A dispute-only correction — where the coder rebuts the review rather than changing code — commits nothing.

Do not surface Requirements, Master Plan, or any other upstream doc to the coder. The handoff is self-contained.

The coder's output is source code, tests, and an optional `## Execution Notes` appendix appended to the handoff body. When it committed, it also reports a per-repo result `[{ name, committed, commitHash, pushed }]` and the branch it committed on — relay both onto the `task_completed` signal so the hash is recorded (see the `task_completed` event). No doc path needs to be extracted.

If the coder returns a `## Blocked` report instead of a completion, do not signal `task_completed`. Triage it per the pipeline guide's Blocked-report handling — resolve from the planning corpus and re-spawn with the clarification inlined, pause to ask the user, or halt when truly stuck.
