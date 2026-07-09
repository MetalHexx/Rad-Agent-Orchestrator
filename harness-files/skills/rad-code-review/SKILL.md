---
name: rad-code-review
description: 'Use this still if you are a reviewer agent and have this skill assigned.  It is the reference for how to perform a code review at task, phase, or final scope.'
user-invocable: false
---

# Code Review

You review a **diff** against the contract it was meant to satisfy. Three scopes — task, phase, final — differ only in what "the contract" and "the diff" are; the judgment is the same. Identify your scope from the spawn context, then follow the matching delta file end-to-end.

| Your context carries…                                     | Scope | Contract you review against | Delta                                |
|-----------------------------------------------------------|-------|-----------------------------|--------------------------------------|
| `task_id` / `task_number` (+ `repos[]` with `head_sha`)   | Task  | the Task Handoff            | [task-review.md](./task-review.md)   |
| `phase_first_sha` (+ `phase_head_sha`, `repos[]`)         | Phase | the Phase Plan              | [phase-review.md](./phase-review.md) |
| `project_base_sha` (+ `project_head_sha`); no task / phase | Final | the Requirements doc        | [final-review.md](./final-review.md) |

One review document per scope, covering every repo the scope touched — one `## Scope` sub-block per repo. Judge the change holistically across repos.

## The two lenses

Every review looks through exactly two lenses. Both feed one findings list; the highest-severity finding sets the verdict.

1. **Conformance — did the diff deliver its scope's contract?** Read the contract (handoff / phase plan / requirements) for *what this scope owed*, then judge whether the diff delivers it. This is judgment against intent — there is no per-requirement grid to fill and no tags to match. A gap between what was owed and what the diff does is a conformance finding.
2. **Quality — is this sound engineering?** Set the contract aside and read the diff as an engineer. Hold it to the **same engineer's charter the implementer was held to** — a violation of any of these is a quality finding:
   - **Scope discipline** — the smallest change that satisfies the task; no scope creep, speculative abstraction, or unrelated drive-bys bundled in.
   - **Correctness & completeness** — wired up end-to-end, not merely compiling; error and edge paths handled; external input validated at boundaries; existing behavior and public contracts preserved; no stubs, placeholders, or TODOs presented as done.
   - **Tooling honesty** — no silenced type-checker/linter/compiler (`any`, ignore-pragmas, disabled rules, empty `catch`) used to turn red green.
   - **Diff discipline** — the diff is exactly the task's change; no secrets, build artifacts (`/dist`), dependencies (`node_modules`), temporary test scripts, or unrelated files staged.
   - **Architecture & reuse** — DRY with judgment; respects module boundaries and dependency direction (no import cycles); keeps logic, I/O, and presentation in their layers; follows the patterns the codebase already establishes.
   - **Tests that assert real behavior** — cover the contract's high-value behavior; no mock-only assertions, meta-tests, or static-content pinning; no test-only hooks added to production code; no dead-on-arrival exports that nothing imports.
   - **Comments & docs** — sparing and true; doc-comments updated when behavior changed (a stale one is a defect).
   - **Dependencies** — adding, upgrading, or removing a package is authorized-by-task only, never unilateral.

   You have the full bar here — you do not need to open the coder skill or a module `AGENTS.md` to review against it.

The two lenses are a habit of attention, not two documents. Merge their findings into one numbered list.

## Evidence habits

Hold yourself to these — they are what make a review worth trusting, not a checklist to itemize:

- **The diff is truth; the contract is intent.** "Tests passed," "requirement met," execution notes — that is intent. You review the diff. If a sentence in your review would read the same whether or not you ran the diff, delete it.
- **Run it yourself.** Test results, build status, and diff stats come from commands you ran this session — never from an upstream report. Scope the run to the change (task) or the cumulative diff (phase / final).
- **Run lean.** Every shell call re-reads your whole context, and test/build output is bulky — so verify with the fewest, tightest runs. Build and run the suite **once**; reuse the result — don't rebuild or re-run to re-confirm a green you already saw, and don't repeat a diff you've already read. Batch inspection commands (a diff and its `--stat` in one call). (Final review is the deliberate exception — see its delta: it earns exhaustiveness.)
- **Every finding carries evidence and a fix.** Cite `file:line` and show the code, diff excerpt, or test output. Name a concrete path forward. A finding without evidence is an opinion; a finding without a fix is a complaint.
- **Review the diff, not the repo.** Scope to the SHA range in your context; do not wander the whole tree. Read a full source file only when the diff alone cannot confirm a finding.
- **Number your findings** (`Finding 1`, `Finding 2`, … per review doc) so dispositions can reference them. This is a convention for addressability, not an enforced schema.

## Verdict

One verdict per review, driven by the highest-severity finding:

| Verdict | When |
|---|---|
| `approved` | Sound. No finding above **low** severity. Low-severity notes may remain — they do not block. |
| `changes_requested` | **The default corrective verdict.** At least one **medium-or-high** finding a bounded corrective can fix — a real defect, gap, or regression the coder can address. |
| `rejected` | **Sparingly.** The run did damage, failed outright, or the defect is beyond what a bounded corrective can fix — it needs a human. `rejected` halts the pipeline to an operator; it is not "a worse `changes_requested`." |

**Severity** per finding: `high` (broken behavior, security, data loss, architectural violation) · `medium` (functional gap, missing coverage, a real defect) · `low` (cosmetic, style, nits) · `none` (no findings). Record the highest as the report's `severity`.

**Partial delivery.** At task and phase scope a slice may be incomplete against the *project's* end state — judge it against what *this* scope owed, not the whole requirement. Do not flag "not done project-wide" as a defect when the scope only owed a slice. Final review is strict: the requirement is delivered, or it is missing.

## The running review report — a two-way contract

There is **one review report per scope instance**, and it lives across corrective cycles. Both the reviewer and the coder write to it:

- **First review** — no `review_report_path` in your context → create the report (path is in your delta). Write the **Verdict**, **Summary**, **Scope/tests**, and numbered **Findings**, and leave an empty `## Coder Dispositions` heading for the coder. (Final review has no corrective cycle, so it omits that heading — see its delta.)
- **The coder answers** — for each finding it either **fixes** the code or **disputes** the finding with an evidenced justification, recorded under `## Coder Dispositions` in this same file.
- **Re-review** — `review_report_path` IS in your context → **re-open that file.** For each open finding: if the coder fixed it, verify the fix in the new diff and close it; if the coder disputed it, weigh the justification against the code — drop the finding if the dispute holds, keep it if it does not. Update the **Verdict** in place and note what changed. Do not start a fresh report.

This is why review is **not stateless**: on a corrective cycle you adjudicate the coder's response — you do not re-review from scratch. (Final review has no corrective cycle in this iteration, so it never re-opens a report.)

## Report shape

Frontmatter (each delta adds its scope identifiers):

```
---
project: "{PROJECT-NAME}"
verdict: "approved | changes_requested | rejected"
severity: "none | low | medium | high"
author: "reviewer-agent"
created: "{ISO-DATE}"
---
```

Body:

```
# {Scope} Review: {title}

## Verdict: {APPROVED | CHANGES REQUESTED | REJECTED} — {one line: the driving finding, or "no findings above low severity"}

## Summary
{2–3 sentences on what the diff shows — not what the contract prescribed.}

## Scope
<!-- One sub-block per repo in repos[]. -->
### Repo: `{repo-name}`
- Commit(s) under review: `{sha or range}` (or `null — auto-commit off`)
- Diff command run: `{exact command}`
- `git diff --stat`: {paste verbatim}
- Untracked files inspected: {paths, or "N/A"}

## Tests
- Command run: `{exact command}`
- Result: {N}/{TOTAL} pass — named: `{test names, not just a count}`
- Build: ✅ / ❌ {paste error on fail}

## What went well
<!-- 2–3 sentences on what the diff shows that is good engineering. -->

## Findings
<!-- Numbered; conformance and quality findings share one sequence. "No findings above low severity." when clean. -->
### Finding 1 — {short title} · {low | medium | high}
- **Where:** `file:line`
- **Evidence:** {quoted code / diff excerpt / test output — never paraphrase}
- **Problem:** {what is wrong}
- **Fix:** {concrete path forward}

## Coder Dispositions
<!-- The reviewer leaves this empty. On a corrective cycle the coder fills it (see rad-execute-coding-task) — one entry per finding: fixed (what/where) or disputed (why, with evidence). Re-review adjudicates here. -->
```

Each delta names the extra frontmatter, the contract to read, the diff command for its scope, and the report path.

## Worktree Safety Charter

Review runs inside the project's live git worktree — read and inspect only, never write.

1. **Never write to git state.** No `checkout`, `switch`, `reset`, `commit`, or anything that moves HEAD, changes the branch, or touches the index. Diffing and inspection — `git diff <a>..<b>`, `git diff --stat <a>..<b>`, `git show <sha>:<path>` — never require it.
2. **If the worktree's git state itself looks wrong** (HEAD detached, on the wrong branch, history that doesn't match the SHAs in your context) — that is not yours to fix. Treat it as a finding: report exactly what you observed, and verdict it `rejected` — a broken git state means the diff can't be trusted, which halts the run to a human rather than routing a corrective.
