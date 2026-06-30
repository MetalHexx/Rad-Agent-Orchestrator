# Master Plan Document

You author the project **Master Plan** — the document that turns the approved
Requirements into an ordered set of phases and tasks. Each task is a
**self-contained problem brief**: a human preamble, the files to touch, the change
as a contract, what *done* looks like, and what to test. The Master Plan is the
statement of *how* the work breaks down and lands — enough contract for a coder
agent to execute a task without opening another document, never the finished code
itself.

## Workflow Steps

1. **Carry the requirements context in.** The approved Requirements doc is the
   seed — its repos, its `R{n}` requirements, its Technical Specification and
   Testing Approach. Don't re-derive scope or re-interview the user. Carry the
   sealed `project-type`, `repos`, and `repo-group` from its frontmatter forward
   verbatim (see Output Contract).

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
     `repos:` seal.

   Re-emit with the narrow correction; leave the rest intact. The loop has a
   hardcoded cap of 3 retries — after the cap the pipeline halts for manual help.
   On retries, stay narrow: fix only what `last_parse_error` flags.

3. **Pick up the tooling.** Read the Requirements doc's `## Required Skills and
   MCPs` for the repo skills and MCP servers surfaced during requirements
   authoring. If you need more, list a repo's skill catalog yourself — pass the
   repo's absolute path as `--repo-root`:

   ```
   node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" skill-list --repo-root <absolute-repo-path>
   ```

   Read a listed skill only when its description matches the work; bake its
   conventions into the relevant task so the coder carries what it needs and isn't
   required to read skills or call MCPs to proceed.

4. **Ground with targeted codebase discovery.** Grep / Glob / Read the exact
   files, contracts, and modules the tasks will touch, so every `Files` path and
   every contract you pin is real, not guessed. Read the `CLAUDE.md` / `AGENTS.md`
   in each area you'll touch. No survey-level exploration.

5. **Decide the phase and task breakdown.** Phases group work by natural seam and
   are the integration unit — a phase can span repos (a UI view and its API
   endpoint are two single-repo tasks under one phase). Tasks are the smallest
   unit one coder agent executes end-to-end, and each targets exactly one repo.
   Apply the Phase/Task Size knob and the sizing judgment in the Authoring Guide;
   let size, not seam count, set how many tasks you write.

6. **Author the Introduction.** One or two short paragraphs (2–3 sentences each):
   what is being built and why, at a glance, in the requirements-preamble voice.
   No phase-by-phase restatement — the Execution Map is the index.

7. **Author the Execution Map.** A durable, scannable outline of the whole plan
   that a human reads before the run. It lives **above** the first phase heading,
   in the parser's preamble region, so every phase here is a **bold label, never a
   heading** — `**P01 · {Title}** · repos: … · order: T01→T02` — followed by a task
   mini-table (`Task · Repo · Complexity · Purpose`). Never write `## Phase`,
   `## P1`, or any `## P{NN}:` / `### P{NN}-T{MM}:` line in this section; those
   patterns belong only to the full blocks below (see Heading discipline under
   Output Contract).

8. **Author the full phase + task blocks.** Below the Execution Map, write the
   real anchors the explosion reads: a `## P{NN}: {Title}` per phase with a 1–2
   line phase outcome, and a `### P{NN}-T{MM}: {Title}` per task carrying its
   `Task type` / `Complexity` / `Target repo` / `Files` / `The change` /
   `Done when` / `Testing`. Match the worked block in the Authoring Guide at a
   contract-rich-middle density. Don't hand-write a phase task table or a
   `## Execution Notes` section — the explosion generates both.

9. **Self-check.** A quick judgment pass before saving (see the Self-check nudge in
   the Authoring Guide). The parser enforces structure; you check substance.

10. **Save** to `{PROJECT-DIR}/{NAME}-MASTER-PLAN.md`.

## Output Contract

**Filename**: `{NAME}-MASTER-PLAN.md` at the project root.

**Frontmatter** — the [template](templates/MASTER-PLAN.md) carries the canonical
block; copy it from there. These mechanical fields are what the rest of the chain
inherits, so get them right.

Standard project:

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
- `project-type`, `repos`, `repo-group`: carried forward from the Requirements
  doc's sealed frontmatter. `standard` maps to one or more registered repos;
  `side-project` seals `repos: ["{PROJECT-NAME}"]` and `repo-group: null`. The
  `repos:` array is the **authoritative seal** the explosion reads — every task's
  `**Target repo:**` must be a member of it.
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

**Body section order**:

1. `# {PROJECT-NAME} — Master Plan`
2. `## Introduction`
3. `## Execution Map`
4. `## P01:` … `### P01-T01:` … (the full phase + task blocks)

The explosion generates the per-phase task table, the per-task `## Execution Notes`
section, and the phase docs — don't hand-write them.

## Authoring Guide

A few high-signal nudges that invoke judgment, not a checklist to fill. The craft
is in how richly you pin each task — start here.

**Authoring density — the contract-rich middle**

This is the call you make on every task, and the one that most shapes whether the
run lands. Aim for a **contract-rich middle**: distinctly richer than a one-line
brief, never a finished implementation.

- **Inline the shape, not the body.** Pin the interface — signatures, types,
  endpoints, data shapes — the load-bearing seams, and the gotchas (especially
  cross-repo contracts). Add a *small* illustrative snippet where a shape is
  non-obvious and prose would be clumsier. Never pre-write the full implementation
  or a complete test file — that's the coder's job, and over-specifying it invents
  bugs (a pre-written test that contradicts a pre-written impl).
- **Specificity scales inversely to coder tier.** A `simple` task needs the *most*
  concrete contract — it routes to the junior agent with the least judgment to fill
  gaps, so pin the shape tightly. A `complex` task routes to the senior agent and
  can lean more on its judgment and say less. Calibrate density to the complexity
  you stamped.
- **Aim slightly over-specified, never thin.** Snippets are encouraged where they
  de-risk the change. The one test for "too much": *could a coder paste it verbatim
  and call the task done?* If yes, you wrote the answer, not a contract — cut back
  to the shape.

*Shape, not body — a quick before/after:*

- *Too thin:* "Add a retry wrapper around the fetch call."
- *Too much (the body):* a 40-line function with the full backoff loop, jitter
  math, and error mapping pasted in.
- *Contract-rich middle:* "Wrap `fetchPage(url)` in a retry helper —
  `retry<T>(fn: () => Promise<T>, opts: { tries: number; baseMs: number }): Promise<T>`
  — exponential backoff (`baseMs * 2^n`), retry only on 5xx and network errors,
  rethrow 4xx immediately, give up after `tries`. Default `{ tries: 3, baseMs: 200 }`.
  The seam that bites: a 4xx must *not* be retried."

**Sizing**

One flexible **Phase/Task Size** knob governs how much scope a single task carries.
It's a posture, not a quota.

- **Size beats seams.** When natural seams suggest more tasks than the chosen size
  implies, **consolidate — never split.** Seams shape the *ordering* of work, not
  the *count* of tasks. A coherent change stays one task even if it crosses two
  modules.
- **Flexible, not a fixed count.** A bigger project simply yields more tasks at the
  same scope; nothing is dropped to hit a number. There is no cap on phases or
  tasks.
- **Seam judgment.** Prefer natural module/application seams, but don't fragment a
  coherent change to honor one, nor bundle unrelated work to reach a size. The repo
  boundary is the safest seam (one repo per task) — inside a monorepo, where that
  seam isn't available, be extra deliberate about where one task ends and the next
  begins.

**Complexity**

Every task carries one complexity signal — `simple | standard | complex` — a
stable, semantic property of the work that the orchestrator maps to a right-sized
coder agent.

- **Bias toward `simple`.** Most tasks should be `simple` or `standard`. `complex`
  is rare by design: a plan full of `complex` is a sizing smell — break the work
  down or consolidate until the complexity reads honest.
- **Escalation justifies itself.** Reach for `complex` only when the task genuinely
  demands senior judgment — a subtle algorithm, a tricky cross-cutting refactor, a
  high-blast-radius seam. If you can't name why it's hard, it isn't `complex`.
- **Render complexity only.** Write the complexity, never a resolved agent name.
  The complexity → coder-tier mapping is owned by orchestration policy; naming an
  agent here would drift out of sync.

**One repo per task**

A task targets exactly one repo, named on a singular `**Target repo:**` line. This
is authoring policy that keeps each task a clean, independently-executable unit —
not a parser gate.

- **The phase is the integration unit.** A phase may span repos: a UI view and the
  API endpoint it calls are two single-repo tasks under one phase, knit together
  when the phase completes.
- **Pin cross-repo contracts into both tasks.** When two tasks meet at a seam — an
  endpoint's request/response shape, a shared event payload — write the agreed
  contract into *both* briefs, so each codes independently against the same shape
  and they meet in the middle. Don't make one task reach into the other's repo.

**Testing by judgment**

Each task's `**Testing**` block states what to cover and what to skip — a judgment
call, never a fixed ceremony.

- **Cover the behavior that matters; skip the brittle.** Test the logic and
  contracts that carry risk. Avoid tests that break on a reword or only re-assert a
  mock.
- **Lean against asserting static content.** Asserting a doc's exact prose is the
  classic brittle test. Config is a spectrum: config with real behavior or
  validation can be worth testing; static values usually aren't. Judge case by
  case.
- **The task `type` informs, it doesn't dictate.** A `code` task usually warrants
  tests and a `doc` task usually doesn't — but say what's worth covering, don't
  apply a rule. Inherit the test levels (unit / integration / e2e) from the
  Requirements Testing Approach.
- **Keep the anti-patterns out** of what you ask for: no test-only methods or
  accessors in production code; no assertions that verify only mock behavior; no
  meta-tests asserting on test structure; no content-assertion tests on static
  prose.

**Self-check**

Before saving, a quick judgment pass — not a structural lint (the parser enforces
shape):

- Every task's `**Target repo:**` is a member of the sealed frontmatter `repos:`.
- Paired cross-repo tasks pin the *same* contract on both sides.
- Complexity reads honest — and `complex` is the exception, not the rule.
- Each brief is contract-rich, not thin: a coder has the shape to land it without
  opening another doc.

**A worked task block**

A realistic block at the target density — a pinned signature, a named seam, a small
illustrative snippet, and no full implementation. Match this bar.

````markdown
### P02-T03: Add cursor-paginated search endpoint

Add the `GET /api/search` endpoint the results view calls: it takes a query and an
optional cursor and returns a page of matches plus the next cursor, so the client
can scroll without offset drift. When it lands, the search view can fetch and page
results against a stable contract.

**Task type:** code
**Complexity:** standard
**Target repo:** fake-api

**Files**
- Create: `src/routes/search.ts` (route handler + request/response types).
- Read for patterns: `src/routes/feed.ts` (the existing cursor-pagination handler —
  mirror its cursor encoding and tie-break), `src/db/queries.ts` (`searchArticles`
  already exists).
- Wire into: `src/routes/index.ts` (register the route).

**The change**
- Handler contract, matching the framework's typed-route convention:
  ```ts
  // GET /api/search?q=string&cursor=string&limit=number (1–50, default 20)
  type SearchResponse = {
    results: ArticleSummary[];   // reuse the shared ArticleSummary type
    nextCursor: string | null;   // null when this is the last page
  };
  ```
- Decode `cursor` with the existing `decodeCursor()` in `src/db/cursor.ts`; an
  invalid cursor is a `400`, not a `500`.
- `q` is required and trimmed; an empty `q` after trim returns `400` with
  `{ error: "query required" }`.
- **The seam to get right:** the cursor is an opaque base64 of `{ publishedAt, id }`,
  and the query pages by that composite key — paging by `publishedAt` alone drops
  articles that share a timestamp. `feed.ts` already handles the tie-break.

**Done when**
- `GET /api/search?q=climate` returns a page of matches and a `nextCursor`.
- Following `nextCursor` returns the next page with no repeats or gaps across a
  timestamp tie.
- An empty/whitespace `q`, or a malformed `cursor`, returns `400`.

**Testing**
- Cover the contract: a happy-path page, a cursor round-trip across a `publishedAt`
  tie (the seam above), and the two `400` paths.
- Skip snapshotting full payloads and asserting exact ordering beyond the tie-break
  — assert the shape and the boundary behavior.
````
