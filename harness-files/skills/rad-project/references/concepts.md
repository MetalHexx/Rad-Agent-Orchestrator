# Concepts

## What a project is

A **project** is the unit of orchestration work. Every project in the system carries three facts:

- **status** — where it sits in its lifecycle (see below).
- **tier** — the review intensity applied during planning and code review.
- **type** — the kind of work (e.g. `standard`, `side-project`).

## Status and "active"

A project is **active** when its `status` is `in_progress`. The terms are interchangeable — "show me what's active" and "show me what's `in_progress`" resolve the same way via `project list --status in_progress`.

## What a project-group is

A **project-group** is a named bundle of projects (and optionally sub-groups). Every group carries a **required, load-bearing description** — the scoping rationale that tells an agent what domain this group covers and why it would look there. The description cannot be blanked once set.

## Relationship edges

Projects and groups are connected by typed edges. The known edge types are:

- **`contains`** — a group contains a project or sub-group. This is the containment frame, not a drawn relationship (set via `project-group add`).
- **`follows`** — a project follows another in a series (e.g. iteration 2 follows iteration 1). Asserts an ordering.
- **`depends-on`** — a project is blocked by another. Asserts an ordering.
- **`spawned-from`** — a project branched off from another as an offshoot (e.g. a side investigation spun out mid-project). Asserts origin only, no ordering.

This set is extensible: unknown edge types are accepted by the CLI and treated as decoration — drawn, but exerting no ordering force.

## Side-project vs. spawned-from

These are distinct concepts:

- **`spawned-from`** is a relationship edge — it says project B *branched off from* project A while A was in flight.
- **`side-project`** is a `project-type` — it marks a project as a local-only repo effort, explicitly scoped to a single machine. A side-project may or may not have a `spawned-from` edge; the edge and the type are independent.

## Location kinds

When `project locate` classifies a directory, it returns one of four `kind` values: `worktree` (a registered project worktree under `~/.radorc/worktrees/`), `main-clone` (the bare repository clone), `side-project` (a local-only repo registered as a side-project), or `none` (no match found in the registry).

## Where to work

Find the right worktree for a project before acting. See [where-to-work.md](where-to-work.md).
