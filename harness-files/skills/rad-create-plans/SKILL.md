---
name: rad-create-plans
description: "Use this skill if you are a main agent authoring planning documents (Requirements, Master Plan, or an amendment to one) — every mode is followed inline by the main agent, never delegated to a subagent.  This is triggered by the pipeline, a brainstorm handoff, or an amendment dispatch.  It is the reference for how to author planning documents in the rad-orc workflow."
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
- **`amendment`** — author an **amendment** to an already-approved Master Plan.
  Followed **inline by the main agent**, once `/rad-amend` holds the rationale
  from the conversation; the main agent grounds against the current working
  tree and authors the new phase and task blocks itself.

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
| `amendment` | `references/amendment/workflow.md` |

The caller declares the mode it is invoking under:

- The **main agent**, handed off from `/rad-brainstorm`, authors the Requirements
  doc inline under `requirements`.
- The **main agent**, handed the `spawn_master_plan` action by the pipeline,
  authors the Master Plan inline under `master-plan`.
- The **main agent**, running `/rad-amend` once it holds the rationale from
  the conversation, authors the amendment document inline under `amendment`.
