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

# {PROJECT-NAME} — Master Plan

## Introduction

{Lean preamble — 1–2 short paragraphs (2–3 sentences each): what is being built and
why, at a glance, in the requirements-preamble voice. Don't restate the phases below
— the Execution Map is the index.}

## Execution Map

{A scannable, editable outline of the whole plan. Each phase is a **bold label, not a
heading** — headings are reserved for the full blocks below — followed by a task
mini-table. A phase may span repos; each task targets one.}

**P01 · {Phase Title}** · repos: {repo-a}, {repo-b} · order: T01→T02

| Task | Repo | Complexity | Purpose |
|---|---|---|---|
| T01 | {repo-a} | standard | {one-line purpose} |
| T02 | {repo-b} | simple | {one-line purpose} |

## P01: {Phase Title}

**Intent**
{One to two sentences: the capability that exists when the phase completes, and
why it matters. Not a restatement of the task titles below.}

**Exit criteria**
- {A concrete, checkable condition that means the phase is done — what phase
  review verifies against the diff.}
- {…}

**Integration seams**
- {A cross-task or cross-repo boundary this phase knits together — an endpoint
  and the view that calls it, a shared event payload — for phase review to
  check beyond each task's own correctness.}

No task table here — the explosion generates it.

### P01-T01: {Imperative task title, 4–7 words}

{2–3 sentence human preamble in plain language, for someone skimming the run: the
goal, and what exists once it lands.}

**Task type:** code
**Complexity:** standard
**Target repo:** {repo-a}

**Files**
- Create: `{repo-relative/path}` ({what it is}).
- Read for patterns: `{repo-relative/path}` ({the pattern to mirror, or the gotcha to
  note}).

**The change**
- {The contract: the signature / endpoint / type / data shape — pin the shape, not
  the body. A small illustrative snippet where a shape is non-obvious:}
  ```ts
  {a signature or type, not a full implementation}
  ```
- {Load-bearing behavior and edge cases.}
- **The seam to get right:** {the gotcha, or the cross-repo contract this task shares
  with its paired task — pin the same shape on both sides}.

**External surface** *(only when this task builds against something it doesn't own — a
library, service, or module defined elsewhere; omit for greenfield / self-defined work)*
- How to reference it — the exact statement that brings each external symbol into scope
  (import / require / use / include — whatever the task's language uses), and its source:
  ```
  {reference statements, in the task's language}
  ```
- Resolved shapes — every externally-defined type / struct / interface / schema /
  signature named above, given concretely so nothing has to be opened to build against it:
  ```
  {the definitions, verbatim from source, in the task's language}
  ```
- Name the true source of each symbol — one from a sibling package or module is not the
  same as the primary entry point.

**Done when**
- {Concrete, observable acceptance — what is true when the task is complete.}
- {…}

**Testing**
- {What's worth covering — the behavior and contracts that carry risk.}
- {What to skip — the brittle assertions to avoid.}

### P01-T02: {Imperative task title}

{2–3 sentence human preamble.}

**Task type:** code
**Complexity:** simple
**Target repo:** {repo-b}

**Files**
- Modify: `{repo-relative/path}` ({what changes, with any gotcha annotation}).

**The change**
- {The contract / shape for this task. Where it consumes the paired task's seam,
  restate the **same** agreed contract here so this repo codes against it
  independently.}

**Done when**
- {Concrete acceptance.}

**Testing**
- {What to cover; what to skip — by judgment.}
