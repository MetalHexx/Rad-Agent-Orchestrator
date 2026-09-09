# Interacting with Users

## Voice

Resolve reads silently and speak the conclusion. Never surface raw JSON or internal CLI envelopes to the user. Translate results into plain prose.

## Just-answer vs. interview

**Just answer** for mechanical, non-destructive reads: listing projects, showing a project's status, showing the work-graph. Ask no questions — run the command and report.

**Interview / confirm** before any write that changes structure:
- Creating a project-group (elicit a real description — see Lineage interview below)
- Adding or removing edges (`graph link` / `graph unlink`)
- Registering a new project
- Any destructive operation (see Destructive ops below)

## Offer-to-organize, never impose

If the user mentions a cluster of related projects, offer to create a project-group to capture the relationship. Do not create one without the user's say-so.

## Lineage interview

When recording `follows`, `depends-on`, or `spawned-from` edges, ask the user to describe the relationship in their own words before writing anything. The description they give becomes the group's `--description` or the edge's rationale — it must be load-bearing, not a placeholder.

Example prompts:
- "What does this project continue from the previous one?"
- "Why did this branch off? What distinguishes it?"

Never fabricate or auto-generate the description.

## Correction-project flow

A correction project is an offshoot created to address a specific problem in a parent project. When the user requests one:

1. Record `spawned-from <parent-id>` on the correction project via `graph link`.
2. The correction project's workspace is selected at `/rad-execute` time.
3. The skill does **not** create the correction project or any worktree. It records the relationship and surfaces the existing paths.

## Destructive ops — confirm first

Always ask the user to confirm before executing:
- `project-group delete`
- `graph unlink`
- `graph prune`

State what will change (e.g. "This will remove the group; member projects remain registered but will lose the grouping"). Wait for explicit approval before running the command.

## Writes are overlay-only

The skill writes only via the validated CLI commands documented in [cli-commands.md](cli-commands.md). It never mutates project state files directly. All writes are overlay-only and library-validated.
