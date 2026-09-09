# Master Plan Document

You author the project **Master Plan** — the document that turns the approved
Requirements into an ordered set of phases and tasks.  The Master Plan is the 
statement of *how* the work breaks down and lands. Each task is a **self-contained**: 
a human preamble, the files to touch, the change as a contract, what *done* looks 
like, and what to test — enough contract for a coding agent to execute a task
 without opening another document, never the finished code itself. 

## Workflow Steps

1. **Carry the requirements context in.** The approved Requirements doc is the
   seed — its repos, its `R{n}` requirements, its Technical Specification, Design 
   requirements and Testing Approach.
   - Don't re-derive scope or re-interview the user. 
   - Carry `project-type` and `repo-group` from its frontmatter forward verbatim. 
   - Finalize `repos:` here — it is exactly the set of repos named by the `**Target 
   repo:**` lines of the tasks you author. A repo the Requirements carried as a 
   candidate that no task ends up touching is dropped from the frontmatter. The
   Requirements body's `## Reference` material is for you to ground with for authoring,
   but never appear in the frontmatter `repos:` field.

2. **Recover from a prior parse failure (retries only).** Read
   `state.graph.nodes.master_plan.last_parse_error` from `state.json`. If it is
   `null`, skip this step and author normally. If it is set, a prior attempt
   failed the explosion parser; the field is structured —
   `{ line, expected, found, message }`. Read the prior plan at
   `state.graph.nodes.master_plan.doc_path`, then fix **only** the exact issue at
   the indicated line — do not re-engineer the plan. Common failures in this
   shape:
   - A malformed phase heading: `## P{NN}:` with a missing or single-digit number
     (it must be zero-padded two digits, e.g. `## P01:`).
   - A malformed task heading: `### P{NN}-T{MM}:` with a broken id (e.g. `T-1`,
     `TX`).
   - A task heading whose phase id doesn't match its enclosing `## P{NN}:`.
   - A task missing its `**Target repo:**` line.
   - A task whose `**Target repo:**` names a repo outside the sealed frontmatter
     `repos:` array.
   - A frontmatter `repos:` array that carries a repo no task's `**Target repo:**` 
     names. Either drop the repo from the array, if it was reference-only, or add 
     the task that should have targeted it.

   Re-emit with the narrow correction; leave the rest intact. The loop has a
   hardcoded cap of 3 retries — after the cap the pipeline halts for manual help.
   On retries, stay narrow: fix only what `last_parse_error` flags.

3. **Pick up the tooling.** Read the Requirements doc's `## Required Skills and
   MCPs` for the repo skills and MCP servers surfaced during requirements
   authoring. If you need more, list a repo's skill catalog yourself using its
   registered name:

   ```
   node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" skill list --repo rad-orc-source
   ```

   Read a listed skill only when its description matches the work; bake its
   conventions into the relevant task so the coding agent carries what it needs and isn't
   required to read skills or call MCPs to proceed.

4. **Ground with targeted codebase discovery.** Grep / Glob / Read the exact
   files, contracts, and modules the tasks will touch, so every `Files` path and
   every contract you pin is real, not guessed. Read the `CLAUDE.md` / `AGENTS.md`
   in each area you'll touch — they carry the coding conventions and nuances a task
   in that module / repo must respect. **Inline the conventions each task depends on
   into that task's handoff**, so the coding agent carries them and never has to open
   an `AGENTS.md` — or go hunting through the codebase — to proceed. The coder works
   from a self-contained handoff and is told not to read upstream docs, so a
   convention you leave out is a convention it won't apply.

   **Capture what you read as the External surface.** The grounding read already hands you
   each dependency's exact reference (import / require / use) and resolved shape — pin those
   into the task's **External surface** rather than paraphrase and discard them. A named-but-
   unresolved type just sends the coder to re-read the source you already paid to open.

5. **Decide the phase and task breakdown.** Phases group work by natural seam and
   are the integration unit — a phase can span repos (a UI view and its API
   endpoint are two single-repo tasks under one phase). Tasks are the smallest
   unit one agent executes end-to-end, and each targets exactly one repo.
   Apply the Phase/Task Size knob and the sizing judgment in
   [the authoring standard](../authoring-standard.md); let size, not seam count, set
   how many tasks you write.  Seams are still important - they should influence
   rationale for work boundaries.

6. **Author the Introduction.** One short paragraph (2–3 sentences):
   what is being built and why, at a glance, in the requirements-preamble voice.
   No phase-by-phase restatement — the Execution Map is the index.

7. **Author the Execution Map.** A durable, scannable outline of the whole plan
   that a human reads before the run. It lives **above** the first phase heading,
   in the parser's preamble region, so every phase here is a **bold label, never a
   heading** — `**P01 · {Title}** · repos: … · order: T01→T02` — followed by a task
   mini-table (`Task · Repo · Complexity · Purpose`). The `repos:` on a phase label
   are the repos that this phase touch. Never write `## Phase`,
   `## P1`, or any `## P{NN}:` / `### P{NN}-T{MM}:` line in this section; those
   patterns belong only to the full blocks below (see Heading discipline under
   Output Contract).

8. **Author the full phase + task blocks.** Below the Execution Map, write the
   real anchors the explosion reads: a `## P{NN}: {Title}` per phase, and a
   `### P{NN}-T{MM}: {Title}` per task carrying its `Task type` / `Complexity` /
   `Target repo` / `Files` / `The change` / `Done when` / `Testing`. Match the
   worked block in [the authoring standard](../authoring-standard.md) at a
   contract-rich-middle density. Don't hand-write a phase task table or a
   `## Execution Notes` section — the explosion generates both.

   The phase body — everything between a `## P{NN}:` heading and its first
   `### P{NN}-T{MM}:` — is copied verbatim into the exploded Phase Plan. It's
   the phase's entire self-contained brief: phase review works from the Phase
   Plan and the cumulative diff alone, with no requirements ledger to fall back
   on. Write three bold-labeled subsections (never `## P`, `### P`, or
   `## Phase` — those are parser anchors; see Heading discipline):
   - **Intent** — one to two sentences: the outcome this phase delivers and why
     it matters. Not a restatement of the task titles below it.
   - **Exit criteria** — the concrete, checkable conditions that mean the phase
     is done. Phase review verifies each one against the diff and sets
     `exit_criteria_met` from them — write what's observably true, not a recap
     of what the tasks did.
   - **Integration seams** — the cross-task and cross-repo boundaries this
     phase knits together (an endpoint and the view that calls it, a shared
     event payload) — what phase review must check beyond each task's own
     correctness.

9. **Self-check.** A quick judgment pass before saving (see the Self-check section
   of [the authoring standard](../authoring-standard.md)). The parser enforces
   structure; you check substance.

10. **Save** to `{PROJECT-DIR}/{NAME}-MASTER-PLAN.md`.

## Output Contract

**Filename**: `{NAME}-MASTER-PLAN.md` at the project root.

**Frontmatter** — the [template](templates/MASTER-PLAN.md) carries the canonical
block; copy it from there. These mechanical fields are what the rest of the chain
inherits, so get them right.

Standard project:
_A project that spans one or more registered repositories._

```yaml
---
project: "{PROJECT-NAME}"
type: master_plan
status: draft
created: "{YYYY-MM-DD}"
project-type: standard
repos: [repo-a, repo-b]
repo-group: repo-group-name
total_phases: {N}
total_tasks: {N}
---
```

Side-project:
_Projects that don't pertain to a specific repo.  Usually an experiment or one off project._

```yaml
---
project: "{PROJECT-NAME}"
type: master_plan
status: draft
created: "{YYYY-MM-DD}"
project-type: side-project
repos: ["{PROJECT-NAME}"]
repo-group: null
total_phases: {N}
total_tasks: {N}
---
```

- `status`: `draft` | `approved`. Always `draft` at authoring time; approval
  happens later in the pipeline.
- `project-type` and `repo-group`: carried forward from the Requirements doc's
  sealed frontmatter. `standard` maps to one or more registered repos; 
  `side-project` seals `repos: ["{PROJECT-NAME}"]` and `repo-group: null`.
- `repos:` is finalized at authoring time — it is exactly the set of repos named by 
  the `**Target repo:**` lines of the tasks you author. The `repos:` array is the 
  **authoritative set** of repos touched by the project. The repo array set is an
  equality enforced in both directions:
  - Every task's `**Target repo:**` is a member of the `repos:` array.
  - Every member of the `repos:` array is named by at least one task.
  A violation in either direction will fail plan validation.
- `total_phases`: count of `## P{NN}:` headings. `total_tasks`: count of
  `### P{NN}-T{MM}:` headings.
- No `author` field — git carries provenance.

**Heading discipline (the collision guard).** The explosion parser anchors on
`## P{NN}:` and `### P{NN}-T{MM}:` and treats everything above the first such
heading as preamble. It throws on any `## P{digit}…`, `### P{digit}…`, or
`## Phase…` line that is not a well-formed anchor. So the Execution Map, which
lives in the preamble region, uses **bold phase labels and mini-tables, never
headings** (Step 7). The real `## P{NN}:` / `### P{NN}-T{MM}:` headings appear only
below it, opening the full blocks. Zero-pad to two digits: `P01`, `P02`, `P01-T01`.
The same discipline holds inside a phase body: its Intent / Exit criteria /
Integration seams subsections (Step 8) are bold labels too, not headings.

**Task numbering restarts every phase.** Each phase's tasks are numbered `T01`,
`T02`, … starting fresh from `T01` — a second phase's first task is `P02-T01`,
never a continuation of the first phase's count. Numbers must run consecutively
with no gaps. Explosion rejects a plan whose task numbers don't restart at `T01`
in every phase or skip a number mid-phase.

**Body section order**:

1. `# {PROJECT-NAME} — Master Plan`
2. `## Introduction`
3. `## Execution Map`
4. `## P01:` … `### P01-T01:` … (the full phase + task blocks)

The explosion generates the per-phase task table, the per-task `## Execution Notes`
section, and the phase docs — don't hand-write them.
