---
name: rad-project
description: Use this skill when the user references a project that you're not aware of or need additional context about.  It is the reference for how to answer questions about project identity, relationships, project worktree location and how projects interrelate.  You may uncover important context for the current project at hand if you know how it relates to other projects.  Also consider using this when a user is creates a new project as it might need to have a relationship created to other projects.  
user-invocable: true
---

# What is the `rad-project` skill?

The work-graph is a live map of the projects in the system — what exists, what state each is in, how they relate, and where their worktrees are. By default your view is the project you're working in, but projects don't stand alone: they're organized into initiatives, they follow one another in a series, or they branch off as offshoots — and each may have worktrees across one or more repos. Use it to answer three things: what projects exist and what's in progress; how a project relates to others (its group, what it follows, what spawned from it); and where a project's worktrees are, so you act in the right place.

# How you should work

- **Orient before acting.** Check what's in progress and where this project sits before diving in.
- **Work in the right place.** Find the project's worktree and act there — see [references/where-to-work.md](references/where-to-work.md).
- **Surface relationships.** Bring "part of X / follows Y / spawned-from Z" into your answers and decisions.
- **Organize when it's messy.** Offer to group related work and capture how projects relate.
- **Keep the structure honest.** Use real group names and descriptions, accurate links — no junk.
- **Report crisply.** Answer "what's going on" without dumping raw data.
- **Know the boundary.** Surface and organize; don't create projects, run the pipeline, or manage worktree lifecycle.

# No-args behavior

`/rad-project` with no prompt returns a summary of the active projects — the `in_progress` set — not a bare help screen. Resolve it via `project list --status in_progress` and present the results in plain language.

# Lane note

This skill handles project identity, relationships, and worktree location. Questions about repository identity and the repo registry belong to `/rad-repo`. Questions about commits and pull requests belong to `/rad-source-control`. Worktree lifecycle (create and clean up) lives in the **act lane** — see `/rad-source-control`.

# Commands & references

- **[references/concepts.md](references/concepts.md)** — what projects, project-groups, and the work-graph are; state model; relationship types. Start here for the *why*.
- **[references/cli-commands.md](references/cli-commands.md)** — the full command and flag reference for `project`, `project-group`, and `graph`.
- **[references/interacting-with-users.md](references/interacting-with-users.md)** — how to surface the work-graph with the user: orientation flow, grouping conversations, and crisply reporting state.
- **[references/where-to-work.md](references/where-to-work.md)** — how to find the right worktree for a project and confirm you're acting in the right place.
