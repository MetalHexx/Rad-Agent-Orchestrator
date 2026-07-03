# Requirements Document

You author the project **Requirements** document — a requirement-grouped spec that
reads top-to-bottom as whole units of work. Each `R{n}` is a thing to build, with
its functional, design, and technical detail co-located. The document is the
statement of *what* to build and *why* — it is **not** an
implementation plan (granular, file-level steps belong to the Master Plan).

## Workflow Steps

1. **Carry the brainstorm context in.** The consensus you reached with the user is
   the seed. Do not re-interview the user or re-derive goals already settled.

2. **Resolve the repo set from the project, not the current directory.** Use the
   project's brainstorm-confirmed repos / the registry via `/rad-repo`. Resolving
   from the project holds in multi-repo and detached/worktree layouts where the
   current directory is not the project.

3. **Discover repo-tied skills.** For each repo in the set, list its skill catalog —
   pass the repo's absolute path as `--repo-root`:

   ```
   node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" skill-list --repo-root <absolute-repo-path>
   ```

   **Skip the repo you are standing in** — the harness already surfaces its skills.
   If you stand above all repos (e.g. a worktrees parent, no current repo), run it
   for every one. Read a listed skill only when its description matches the work;
   skip the rest to avoid token waste.
   - **Capture them in the doc.** Record the surfaced repo skills (each with its
     repo tag) and any connected MCP servers worth reaching for in `## Required
     Skills and MCPs`, so a later Master Plan session — often a fresh context —
     starts with the tooling in hand. Omit the section when a project needs none.

4. **Read repo instruction files** In each area you will touch,
   read `CLAUDE.md`, `AGENTS.md`, and equivalents — including module-level files —
   these files contain important information and nuances about the repo or module.

5. **Ground with targeted codebase discovery.** Grep/Glob/Read the specific code,
   contracts, and modules the requirements depend on. Assume the user is non-technical and will not know the codebase, repo, domain, or other technical details.

6. **Create the project directory on first scribe.** If
   `~/.radorc/projects/{PROJECT-NAME}/` does not exist, create it (do **not**
   create `phases/`, `tasks/`, `reports/` — the pipeline owns those). Project
   names are `SCREAMING-CASE`.

7. **Author the document** per the template and the Authoring guide below. Scribe
   **progressively as consensus forms** — the draft REQUIREMENTS doc is the living
   document during ideation. Keep `status: draft`; revise in place as thinking
   sharpens (don't append a changelog).

8. **Link companion documents.** Any supplemental artifact — visual (wireframes,
   diagrams, HTML summaries from `/rad-visual-docs`) or non-visual (a shared PRD,
   data model, API-contract doc) — is linked from `## Companion Documents` by
   relative path, and **kept in lockstep**: when the requirements change, update
   the companions in the same pass. A stale companion is worse than none.

9. **Save** to `{PROJECT-DIR}/{NAME}-REQUIREMENTS.md`.

## Output Contract

**Filename**: `{NAME}-REQUIREMENTS.md` at the project root.

**Frontmatter** — the [template](templates/REQUIREMENTS.md) carries the canonical
block; copy it from there rather than reproducing it here. These mechanical fields
are what the rest of the chain inherits, so they are critically important to get
right:

- `status`: `draft` | `approved`. Always `draft` at authoring time; approval
  happens later, so don't set `approved` prematurely here.
- `project-type`: `standard` (maps to one or more registered repos) |
  `side-project` (no registered repo — a standalone script/experiment). For a
  side-project, seal `repos: [<project-name>]` and `repo-group: null`.
- `repos`: the **authoritative** set the Master Plan and the rest of the chain
  inherit. Requirement bodies stay repo-agnostic; the repo set lives in
  frontmatter and the Affected Repositories table.
- Do **not** add `approved_at`, `requirement_count`, or `author` — git carries
  provenance and pipeline state carries approval.

**Body sections** — author them in the order the
[template](templates/REQUIREMENTS.md) lays out; include the sections that fit and
omit the ones that don't (the template marks which are conditional).

## Authoring Guide

The template is a **guide, not a contract** — include the sections that fit, omit
the ones that don't (e.g., a backend change has no need for a UI/UX Design section). A few
high-signal nudges, not a checklist to fill and never a book of dense prose:

**Structure**
- **Requirement-grouped.** Each `### R{n}` is one thing to build, with its
  functional + design + technical detail co-located so it reads as a whole unit.
- **Requirement-level IDs only** (`R{n}`) — one ID per requirement, no
  per-statement sub-IDs.
- **Lean preamble.** State the intent and the problem being solved; don't restate
  the Goals that follow.
- **Cross-cutting once.** State system-wide concerns — contracts, data model,
  quality attributes, risks — in the Technical Specification, not repeated per R.

**Voice & form**
- **High-signal bullets** over prose. Keep prose light — for the preamble and a
  requirement's one-line lead.
- **Tables** for models, contracts, and field sets; **mermaid** where a picture
  beats prose; **prose** for behavior and rationale.
- **Target state, never steps.** Describe the system to be built, not the process
  of building it. If a block reads like a task list, it's wrong.
- **Write like a team member, not a stranger.** Match the standards and patterns
  surfaced through instruction files (`AGENTS.md` / `CLAUDE.md`), code, skills, and MCPs,
  so the work blends into the codebase.

**Coverage & judgment**
- **Cover the cross-cutting dimensions that apply** — logging, monitoring, infrastructure, UI/UX (incl. accessibility/a11y). Include the ones that are applicable to the project; omit the rest.
- **Call out security** — when the work crosses a trust boundary, takes user
  input, or handles authn/authz or secrets, name the threats that apply and their
  mitigations. The user won't raise these — you must.
- **State the testing approach** — the test levels that apply and what must be
  covered, plus any fixtures or seams the Master Plan should plan for. Intent, not steps.
- **Assume the user is non-technical.** Never assume the user knows the codebase, the repo, domain, or other technical details.  They will not think about important technical concerns unless you explicitly call them out.  The requirements document is the place to do that.
- **Stay grounded (YAGNI).** As far as features, specify only what was discussed or discovered; don't invent new feature scope.  Ask the user if you think they're unsure or unaware. `## Non-Goals` names what is deliberately out.
- **Don't over or under-engineer.**  If the user is asking for a simple solution, don't propose a complex one.  If the user is asking for a complex solution, don't propose a simple one.  Consider the codebase when making architectural decisions.  The requirements document is the place to do that.
- **Declare environmental assumptions** — framework/runtime versions, package
  installs, and services the work depends on. The doc *states* these.
- **Declare quality attributes** — performance, scalability, reliability,
  maintainability, and other non-functional requirements. The doc *states* these.  If you're unsure, ask the user to clarify.
- **Open Questions** — if a requirement is unclear, capture it in `## Open Questions` and ask the user to clarify; don't assume. Aim to resolve these before `/rad-plan` — anything still open is resolved during planning.

**Companion documents**
- Link supplemental artifacts (visual and non-visual) from `## Companion Documents`
  by relative path, and contextually too where it helps (a wireframe from UI/UX
  Design, a diagram from Technical Specification). Keep them in lockstep.
