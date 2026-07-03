# Project Series

When a project is too large for a single pass, split it into a numbered series. Each project in the series has its own Requirements document, scoped goals, and explicit dependencies on its siblings.

## When to Recommend a Split

Use your judgment. Consider recommending a series when:

- The idea spans multiple distinct subsystems or concerns
- You count 5+ independent goals that don't share implementation overlap
- The user describes something in explicit stages ("first we need X, then Y, then Z")
- A single-shot delivery would take many phases with long dependency chains
- Testing or validation requires intermediate milestones

Don't split for the sake of splitting. A focused 3-phase project is fine as a single project. The bar for splitting is: would these genuinely benefit from independent planning, review, and delivery cycles?

## How to Propose It

When you think a split makes sense, pitch it directly:

> "This feels like it has two distinct chunks: [X] and [Y]. They'd benefit from separate planning and delivery. Want to set this up as a series — `PROJECT-NAME-1` for X and `PROJECT-NAME-2` for Y?"

Let the user decide the boundaries. You recommend; they approve.

## Naming Convention

Series projects follow `{STEM}-{N}` naming:

- `DAG-VIEW-1`, `DAG-VIEW-2`, `DAG-VIEW-3`
- `BETTER-PLAN-DOCS-1`, `BETTER-PLAN-DOCS-2`

The stem is the shared thematic name. The suffix is a sequential integer starting at 1.

Fix/follow-up projects use descriptive suffixes, not series numbers: `DAG-VIEW-2-FIXES`, `AUTO-COMMIT-PR-FIX`. These are related but not part of the numbered series.

## Series Document Structure

Each project in a series gets its own `{NAME}-REQUIREMENTS.md` in its own project folder, carrying series-specific context:

### Series Context Block

Near the top of each project's Requirements doc (in or just after the preamble), include:

```markdown
## Series Context

| Field | Value |
|-------|-------|
| Series | `{STEM}` |
| Position | {N} of {total or "ongoing"} |
| Previous | [{STEM}-{N-1}](../{STEM}-{N-1}/{STEM}-{N-1}-REQUIREMENTS.md) |
| Next | [{STEM}-{N+1}](../{STEM}-{N+1}/{STEM}-{N+1}-REQUIREMENTS.md) or *not yet planned* |
```

- Omit "Previous" for the first project in a series.
- Use "not yet planned" for Next when future scope is uncertain.
- Link to the richest available doc (the Requirements doc).

### Dependency Graph

Each series project should include a dependency graph showing what it receives from prior projects and what it hands off to subsequent ones:

```markdown
## Series Dependencies

### Receives From {STEM}-{N-1}
- {What this project assumes is already built/shipped}

### Delivers To {STEM}-{N+1}
- {What this project will produce that the next one depends on}
```

This makes project boundaries explicit and ensures each project's scope is self-contained.

## Creating a Series

When the user agrees to a series:

1. **Agree on boundaries** — which goals belong to which project in the series
2. **Create project folders** — `~/.radorc/projects/{STEM}-1/`, `~/.radorc/projects/{STEM}-2/`, etc.
3. **Scribe the Requirements docs** — one per project (via `/rad-create-plans`), each with its own goals, scope, and series context
4. **Cross-link** — ensure prev/next links and dependency sections connect the series
5. **Focus the session** — after creating the series structure, zoom into whichever project the user wants to start with

## Continuing an Existing Series

When the user arrives saying "X is done, what's next?" or similar:

1. **Orient with `/rad-project`** — run `project show <name>` on the completed project and `project list` filtered to the series stem to see what exists and what state each entry is in. Surface the series position to the user before any brainstorming begins.
2. **Brainstorm the next entry** — use the live graph context (status, relationships, what was delivered) to inform your questions and proposals.
3. **Offer to link before scribing** — when you're ready to scribe the REQUIREMENTS doc, ask once: "Do you want to link this project to an existing one in the work-graph?" Don't assume the relationship type — let the user describe it in their own words, then hand off to `/rad-project` to record it with the right edge. If they decline, move on.

## Retrofitting Existing Projects

If a completed project needs a follow-on that wasn't originally planned as a series, just create the new project as `{STEM}-2` (or the next available number). Add a "Series Context" section linking back. The original project doesn't need to be modified — forward-linking is optional for already-shipped work.

If the new project relates to the original (follows it, branches from it, or some other relationship), offer to record that via `/rad-project` — let the user describe the relationship first, then link.
