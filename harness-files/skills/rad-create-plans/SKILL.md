---
name: rad-create-plans
description: "Consolidated document-creation skill for Requirements and Master Plan documents. Routes to the per-document-type workflow by the mode the caller declares."
user-invocable: false
---

# rad-create-plans

A consolidated skill for authoring planning documents. Routing is by an explicit
**mode** the caller declares; each workflow is self-contained.

## When to Use This Skill

- **`requirements`** — author the project **Requirements** document. Followed
  **inline by the main agent** during or after a `/rad-brainstorm` collaboration
  (no planner subagent — the brainstorm context carries straight into authoring).
- **`master-plan`** — author the project **Master Plan**. Followed by the
  **`planner` subagent** the pipeline spawns for `spawn_master_plan`.

## DO NOT

Write requirement IDs (`R{n}`, or a Master Plan's requirement tags) inside
the code, tests, or comment bodies you inline into plan steps. IDs are planning
scaffolding — they live on requirement headings and step requirement lines, never
inside the code/test/comment text itself.

## Routing

| Mode | Follow |
|------|--------|
| `requirements` | `references/requirements/workflow.md` |
| `master-plan` | `references/master-plan/workflow.md` |

The caller declares the mode it is invoking under:

- The **main agent**, handed off from `/rad-brainstorm`, authors the Requirements
  doc inline under `requirements`.
- The **`planner` subagent**, spawned for `spawn_master_plan`, authors the Master
  Plan under `master-plan` (see `planner.md`).
