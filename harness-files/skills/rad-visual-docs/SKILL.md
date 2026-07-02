---
name: rad-visual-docs
description: 'Use this skill to help the user generate beautiful brainstorm/summary visuals, UI mockups and wireframes, and architecture / data-flow / sequence / state diagrams. Trigger when the user wants to *see* something: "make me a wireframe / mockup", "diagram this architecture / flow / sequence", "turn this into a visual or HTML summary", "show me a visual" or "visualize the goals".  If you are struggling to align with the user, a visual is often a good way to get on the same page.'
user-invocable: true
---

# Visual Docs

Standalone visual-artifact generation. Produces self-contained HTML documents — content visuals, UI wireframes, and technical diagrams — saved alongside a project's other docs and viewed in the Rad Orchestration UI. 

## The Offer Catalogue — Pick the Right Visual
If its not obvious from the context, determine which artifact fits the need. 

| Visual type | What it is | Reach for it when… | Reference |
|---|---|---|---|
| **HTML summary / content visual** | A polished, self-contained HTML recap of content — goals, notes, a session summary | the user wants to *see* their thinking — a visual summary or polished recap | [make-it-visual.md](./references/make-it-visual.md) |
| **UI mockup / wireframe** | A wireframe of a screen or flow, low→high fidelity | there's a UI / UX surface — a screen, a component, an interaction | [generate-mockup.md](./references/generate-mockup.md) |
| **Architecture / technical diagram** | A code-grounded architecture / data-flow / sequence / state diagram | talk turns technical — components, flows, states, sequences | [architecture-visuals.md](./references/architecture-visuals.md) |

**Offer, don't impose.** Proactively offer a visual when a visual surface appears, but never auto-generate — generate only on confirmation, and follow the user's lead if they decline. (When a caller hands off, it has already decided to offer; you execute.)

**Fidelity ladder (mockups).** Default to **low** unless the user specifies otherwise:

| Level | What it looks like | When to use |
|---|---|---|
| **Low** (default) | Paper-napkin wireframe — dark mode, rough shapes, minimal labels | Quick alignment; early-stage thinking |
| **Medium** | Cleaner layout — grayscale, realistic labels, approximate spacing | Structure/flow needs to be clear; stakeholder-ready |
| **High** | Close to the real app — brand hints, design tokens, polished components | Near-final UI vision |

## Inputs
Resolve each input from the invoking context when present; **ask** when absent.

| Input | Resolve from | If absent |
|---|---|---|
| Visual type | Caller's handoff, or the user's request | Ask which artifact they want (offer the catalogue) |
| Project name | Active project / invoking context | Cold-start: ask for or offer to create a project (`SCREAMING-CASE`) |
| Target filename | Caller's handoff (exact), or the type's naming convention below | Derive from the naming convention |
| Source content | Conversation / linked docs / a ticket key / a screenshot | Ask what to visualize |
| Mode / fidelity | Caller or user | Default (low fidelity for mockups) |

**Handoff contract.** When called from another skill, the caller establishes exactly two things — the **visual type** and the **exact target filename**. Honor both verbatim; resolve everything else (project, source content, fidelity) from context.

## Cold-Start (standalone, no active project)
When invoked directly with no active project, ask for or offer to create a project, then save under `~/.radorc/projects/{NAME}/`. There is no project-less / scratch output path — every artifact lands in a project folder. Create the folder if it doesn't exist; do NOT create subfolders (`phases/`, `tasks/`, `reports/`), that is not the job of this skill.

## Naming Conventions (this skill owns these)
- **Content / brainstorm visual** — the caller passes the exact name (e.g. `{PROJECT}-BRAINSTORM.html`, which fills the dashboard's Brainstorm Visual slot; that slot knowledge lives caller-side — you write what you're told).
- **Wireframe / mockup** — `{PROJECT}-WIREFRAME-{SLUG}.html`, one file per screen; `{SLUG}` is `SCREAMING-CASE`.
- **Architecture / technical diagram** — `{PROJECT}-TECH-DIAGRAM-{SLUG}.html`; `{SLUG}` is `SCREAMING-CASE`.

All `SCREAMING-CASE`. Save to the project root (`~/.radorc/projects/{NAME}/`).

## View in the Dashboard
The Rad Orchestration dashboard is the **canonical viewer** for every artifact this skill produces. After an artifact lands, offer to open it — **never** open a `file://` page in a separate browser tab unless the user asks. On yes, call `/rad-ui-start` — and build the deep link from the `data.url` it returns: `<base>/projects/<PROJECT-NAME>/docs/<FILE-NAME>`. Never hard-code a host or port. Offer once per distinct artifact that lands.

## Routing Table

| Concern | Reference Document |
|---------|-------------------|
| Content visuals / HTML summaries | [references/make-it-visual.md](./references/make-it-visual.md) |
| UI mockups / wireframes | [references/generate-mockup.md](./references/generate-mockup.md) |
| Architecture / technical diagrams | [references/architecture-visuals.md](./references/architecture-visuals.md) |

## Loading Instructions
Read the one reference that matches the chosen visual type — not all three. Each reference is self-contained for its artifact.

## Inputs Summary

| Input | Source |
|-------|--------|
| Visual type + target filename | Caller handoff or user request |
| Source content | Conversation, linked docs, ticket key, or screenshot |
| Base path | `~/.radorc/projects` |
