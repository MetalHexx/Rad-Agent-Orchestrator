---
name: rad-create-plans
description: "Use this skill if you are a main agent who is helping to author planning documents (Requirements or Master Plan).  This is triggered by the pipeline or by a brainstorm handoff.  It is the reference for how to author planning documents in the rad-orc workflow."
user-invocable: false
---

# rad-create-plans

A consolidated skill for authoring planning documents. Routing is by an explicit
**mode** the caller declares; each workflow is self-contained.

## When to Use This Skill

- **`requirements`** — author the project **Requirements** document. Followed
  **inline by the main agent** during or after a `/rad-brainstorm` collaboration
  (the brainstorm context carries straight into authoring).
- **`master-plan`** — author the project **Master Plan**. Followed
  **inline by the main agent**, handed the `spawn_master_plan` action by the
  pipeline.

## DO NOT

Write requirement IDs (`R{n}`) into the code, tests, or comment bodies of the
tasks you author. IDs are planning scaffolding — they live only on the `### R{n}`
headings in the Requirements doc, never inside a task's body, code, test, or
comment text.

## Routing

| Mode | Follow |
|------|--------|
| `requirements` | `references/requirements/workflow.md` |
| `master-plan` | `references/master-plan/workflow.md` |

The caller declares the mode it is invoking under:

- The **main agent**, handed off from `/rad-brainstorm`, authors the Requirements
  doc inline under `requirements`.
- The **main agent**, handed the `spawn_master_plan` action by the pipeline,
  authors the Master Plan inline under `master-plan`.
