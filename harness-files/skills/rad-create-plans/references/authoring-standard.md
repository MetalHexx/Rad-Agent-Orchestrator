# Plan Authoring Standard

A few high-signal nudges that invoke judgment, not a checklist to fill. The craft
is in how richly you pin each task — start here.

**Authoring density — a contract-rich middleground**

This is the call you make on every task, and the one that most shapes whether the
run lands. Aim for a **contract-rich middleground**: distinctly richer than a short
highlevel brief, but distinctly leaner than a full implementation. The goal is to
give the coding agent enough shape to land the task without opening another doc, 
never a finished implementation.

- **Inline the shape, not the body.** Pin the interface — signatures, types,
  endpoints, data shapes — the load-bearing seams, and the gotchas (especially
  cross-repo contracts). Add a *small* illustrative snippet where a shape is
  non-obvious and prose would be clumsier. Never pre-write the full implementation
  or a complete test file — that's the coding agent's job, and over-specifying it invents
  bugs (a pre-written test that contradicts a pre-written impl).
- **Procedure scales with tier; resolution doesn't.** How much *procedure* you spell out —
  the algorithm, the edge handling — scales inversely to tier: a `simple` task (junior)
  says more, a `complex` task (senior) leans on judgment and says less. But the **External
  surface is flat** — full references and resolved shapes at *every* tier. Judgment can't
  derive a real import path or a type's true fields; a dangling name sends even a senior to
  read source, and its re-read costs more, not less.
- **Aim slightly over-specified, never thin.** Snippets are encouraged where they
  de-risk the change. The one test for "too much": *could a coding agent paste it verbatim
  and call the task done?* If yes, you wrote the answer, not a contract — cut back
  to the shape. (This tests the *body* — the External surface is exempt: its resolved shapes
  are ground truth, meant to be used verbatim, not the answer.)

*Shape, not body — a quick before/after:*

- *Too thin:* "Add a retry wrapper around the fetch call."
- *Too much (the body):* a 40-line function with the full backoff loop, jitter
  math, and error mapping pre-written and pasted in.
- *Contract-rich middle:* "Wrap `fetchPage(url)` in a retry helper —
  `retry<T>(fn: () => Promise<T>, opts: { tries: number; baseMs: number }): Promise<T>`
  — exponential backoff (`baseMs * 2^n`), retry only on 5xx and network errors,
  rethrow 4xx immediately, give up after `tries`. Default `{ tries: 3, baseMs: 200 }`.
  The seam that bites: a 4xx must *not* be retried."

**Purpose paragraph — one unwrapped line**

The paragraph immediately after a task's heading is its purpose — the sentence the
Master Plan parser lifts into the regenerated Phase Plan task table and Execution
Map. Write it as a single, unwrapped physical line, never hard-wrapped across
multiple lines. The parser's purpose-extraction heuristic reads the task body line
by line; a wrapped paragraph can be truncated mid-sentence when the plan is
regenerated. This constraint is specific to that lead paragraph — prose deeper in
a task body (`**The change**`, `**Done when**`, etc.) may wrap normally.

**Sizing**

One flexible **Phase/Task Size** knob governs how much scope a single task carries.
It's a posture, not a quota.

- **Size beats seams.** When natural seams suggest more tasks than the chosen size
  implies, **consolidate — never split.** Seams shape the *ordering* of work, not
  the *count* of tasks. A coherent change stays one task even if it crosses two
  modules.  Seams are still guidance.
- **Flexible, not a fixed count.** A bigger project simply yields more tasks at the
  same scope; nothing is dropped to hit a number. 
- **Seam judgment.** Prefer natural module/application seams, but don't fragment a
  coherent change to honor one, nor bundle unrelated work to reach a size. The repo
  boundary is the safest seam (one repo per task) — inside a monorepo, where that
  seam isn't available, be extra deliberate about where one task ends and the next
  begins.

**Complexity**

Every task carries one complexity signal — `simple | standard | complex` — a
stable, semantic property of the work that the orchestrator maps to a right-sized
agent.

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
- **A skill discovered in one repository is folded into a task only when that
  task's `**Target repo:**` is that same repository.** Topical relevance to a task
  in a different repository does not qualify it.
- **A skill named in a task is referenced by its name and its repository, never by
  its absolute path.** Planning documents are read from other worktrees and other
  machines where that path does not resolve.

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

- The sealed frontmatter `repos:` and the union of every task's `**Target repo:**` 
  are the same set — no task names a repo outside the `repos:` array, and no member
  of the `repos:` array is left without a task.
- Paired cross-repo tasks pin the *same* contract on both sides.
- Complexity reads honest — and `complex` is the exception, not the rule.
- Each brief is contract-rich, not thin: a coding agent has the shape to land it without
  opening another doc.

**A worked task block**

A realistic block at the target density — a pinned signature, a named seam, a resolved
external surface, and no full implementation. Match this bar.

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
    results: ArticleSummary[];   // shape resolved under External surface, below
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

**External surface**
- Bring these into scope — exact symbols and their module:
  ```ts
  import { searchArticles } from '../db/queries';
  import { decodeCursor } from '../db/cursor';
  import type { ArticleSummary } from '../db/types';   // its real module — see source note
  ```
- Resolved shapes — everything named above, so nothing under `src/db` has to be opened:
  ```ts
  type ArticleSummary = {
    id: string;
    title: string;
    publishedAt: string;   // ISO-8601
    author: string;
  };
  // already exists — pinned here so the handler needn't open queries.ts
  function searchArticles(
    q: string,
    page: { after?: { publishedAt: string; id: string }; limit: number },
  ): Promise<ArticleSummary[]>;
  function decodeCursor(raw: string): { publishedAt: string; id: string } | null;  // null → 400
  ```
- Source note: `ArticleSummary` lives in `src/db/types.ts`, not the `queries` barrel it
  re-exports through — pin symbols to their real module.

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

*Same two moves, another language — only the syntax changes. The same task in Python:*

```python
# How to reference it — exact symbols and their real module
from app.db.queries import search_articles
from app.db.models import ArticleSummary   # defined in models, not re-exported via queries

# Resolved shapes — so nothing under app/db has to be opened to build against it
@dataclass
class ArticleSummary:
    id: str
    title: str
    published_at: str   # ISO-8601
    author: str

def search_articles(q: str, *, after: tuple[str, str] | None, limit: int) -> list[ArticleSummary]: ...
```
