# Project Memory

When and how to consult past projects to inform the current brainstorm.

## When to Activate

Don't look for projects by default — only when the conversation signals a connection to an existing series or active project. Examples:

- User names a specific project (e.g., "like we did in USER-AUTH-2", "last time we built the installer")
- User references a domain keyword that maps to known projects (e.g., "installer", "pipeline", "schema", "auth")
- User says something like "building on X", "continuation of", "next iteration"
- The idea clearly overlaps with a domain you know has prior projects

Use judgment. If the brainstorm is clearly greenfield with no prior context, skip this.

## Finding Candidates

> **Check `/rad-project` first.** If the conversation signals a connection to an existing series or active project, call `/rad-project` (`project show <name>` or `project list`) before dispatching an Explore subagent. The work-graph gives you live status and relationships instantly. Only fall through to the Explore subagent scan below when you need document *content* that `/rad-project` doesn't surface.

## Can't locate with /rad-project?

Dispatch an **Explore** subagent to scan `~/.radorc/projects`. Instruct it to:

1. **List project folders** in the base path
2. **Strip suffixes** to surface series siblings: remove trailing `-N`, `-N-FIXES`, `-SPIKE` to find the stem (e.g., `DAG-VIEW-4` → stem `DAG-VIEW`)
3. **Match keywords** — compare the new project's domain against folder names for thematic overlap
4. **Return the top ~5 most relevant** project folder names

## What to Read

For each candidate, read the single richest document available, in this priority:

| Priority | Document | Why |
|----------|----------|-----|
| 1 | `{NAME}-REQUIREMENTS.md` | Goals, non-goals, grouped requirements, key constraints — densest signal |
| 2 | `{NAME}-MASTER-PLAN.md`   | Phasing + per-task plan, requirement-ID coverage |
| — | `{NAME}-ERROR-LOG.md`     | What went wrong — avoid repeating mistakes |

Stop at the first document that exists for each project. Don't read multiple docs per project unless you need to cross-reference.

## Using What You Find

- **Inform your suggestions** — prior context lets you ask sharper questions and propose grounded ideas instead of generic ones.
- **Surface relevant highlights** — when a prior project directly informs this one (established scope, deferred work, known constraints), share 1–2 specific findings proactively.
- **Flag overlap** — if the new idea duplicates something already shipped or explicitly descoped, say so before the user invests time in it.
- **Cite your sources** — reference the project and document you drew from. High-relevance findings get an explicit callout; tangential ones can be woven in naturally.
