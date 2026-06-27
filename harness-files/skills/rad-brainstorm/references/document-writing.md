# Document Writing

How to produce the BRAINSTORMING.md — structure, placement, quality bar, and iteration.

## Abstraction Level

This is a **goals document**, not a design document or implementation plan. Capture *what* and *why* — leave *how* to the planning agents.

- **No implementation details** — don't specify algorithms, component hierarchies, state management strategies, or step-by-step technical approaches. That's planning work.
- **Concepts over code** — describe the desired outcome and constraints, not the solution path.
- **When technical context is unavoidable** (e.g., a deeply technical project), keep it to bare references — a key file path, a property name, an API endpoint. One line, not a paragraph.
- **Test yourself**: if a section reads like architecture or a task spec, you've gone too deep. Pull back to the goal it serves.

## File Mechanics

- **Path**: `~/.radorc/projects/{PROJECT-NAME}/{PROJECT-NAME}-BRAINSTORMING.md` — same for **every** kind, side-projects included. A side-project's `~/.radorc/side-projects/<name>/` holds only its code repo (provisioned later at execution); this skill never writes there.
- **Folder creation**: Create `~/.radorc/projects/{PROJECT-NAME}/` if it doesn't exist. Do NOT create subfolders (`phases/`, `tasks/`, `reports/`) — the Orchestrator handles that during project initialization.
- **Template**: Use [../templates/BRAINSTORMING.md](../templates/BRAINSTORMING.md) as the structural skeleton.
- **Project name**: Always `SCREAMING-CASE` (e.g., `MY-NEW-FEATURE`).

## Writing Standards

**Consensus-first**: Every goal in the document should trace to an explicit agreement from the conversation. If you can't point to the moment the user said "yes, let's do that" — it doesn't belong yet.

**Concise and direct**: Write statements, not essays. Each goal gets a description (what), rationale (why), and key considerations (constraints/risks) — nothing more.

**Honest scope**: The "Out of Scope" section is as important as "In Scope." Be specific about what this project will NOT do. Vague scoping leads to scope creep downstream.

**Actionable summary**: The Summary section is the single most important paragraph. It should be clear enough that someone unfamiliar with the conversation could understand what this project is about and begin planning from it. This is the primary handoff to downstream processes.

## Repo Targets

The `## Repo Targets (proposed)` section is **structurally mandatory** — every BRAINSTORMING.md carries it, populated with registry repo names confirmed with the user during the conversation. It is never one of the sections the *Flexibility* guidance below allows skipping. Use the `/rad-repo` skill to help a user register a repository if you sense one is missing before the brainstorm is finalized; never invent an unregistered name, work with the user.

## Link Generated Visuals

If the session produced any visuals — the brainstorm visual `{PROJECT}-BRAINSTORM.html`, or any wireframes/diagrams `/rad-visual-docs` generated into the project root — link them from the **Visual Artifacts** section using relative paths. They're the richest record of the brainstorm — don't leave them stranded as loose files.

## Living Document

The BRAINSTORMING.md is mutable throughout the conversation:

- **Add** new goals as consensus forms
- **Revise** goals when thinking sharpens
- **Remove** goals the user explicitly dropped
- **Reorder** if priorities shift

When the conversation resumes or extends, update the document — don't append a changelog. The document should always reflect the current state of thinking.

## Quality Bar

Before considering the document final, verify:

- [ ] Problem statement is specific enough to direct investigation
- [ ] Each goal has a rationale (not just "we want X")
- [ ] Scope boundaries are explicit — in-scope and out-of-scope
- [ ] Open questions are asked before the brainstorming doc is finalized
- [ ] Summary paragraph is self-contained and unambiguous
- [ ] Related projects are linked (if applicable — see `project-memory.md`)
- [ ] Generated visuals / wireframes are linked in **Visual Artifacts** (if any were produced)
- [ ] Series context is included (if applicable — see `project-series.md`)
- [ ] Repo Targets (proposed) section is present with a confirmed working repo set

## Flexibility

The template is a guide, not a contract. Adapt sections to fit what emerged in conversation:

- Skip "Related Projects" if there are none
- Skip "Key Constraints" if none surfaced
- Add custom sections if the brainstorm produced something that doesn't fit the template (e.g., a rough data model, a comparison matrix)
