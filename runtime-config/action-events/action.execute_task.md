---
kind: action
name: execute_task
title: Execute task
description: Spawn the right-sized coder agent, based on task complexity, to implement the task described in the pre-seeded handoff document.
category: agent-spawn
completion_event: task_completed
---

Spawn the right-sized coder agent for this task — choose the tier from the task's complexity, carried on the envelope as `data.context.complexity` (`simple` | `standard` | `complex`). The handoff document path is carried on the envelope as `handoff_doc` — pass it straight through; it is the coder's sole doc-path input.

The envelope also carries `data.context.repos[]` — an array where each entry has `name`, `path`, and `branch`. Inline the `repos[]` array verbatim into the coder spawn prompt. The coder joins each handoff's `**Files for <repo>:**` section against the matching `repos[N].path` to resolve absolute file targets.

Do not surface Requirements, Master Plan, or any other upstream doc to the coder. The handoff is self-contained.

The agent's output is source code, tests, and an optional `## Execution Notes` appendix appended to the handoff body. No doc path needs to be extracted.
