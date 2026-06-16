# Phase Review

Self-contained workflow for phase-level review (Action #5, `spawn_phase_reviewer`). Do not load other review docs — everything you need is below.

## Your Job

You are the backstop. Task reviews already vetted each commit in isolation against its own handoff. Four approved task reviews do not equal a green phase — task reviewers see their commit; you see all of them. Your unique value is what spans tasks: integration, contract drift at task boundaries, exports that never get imported, conflicting patterns across tasks. If the cumulative phase diff reveals something every task reviewer missed, that's on you to catch.

## Review Mindset

- **The diff is truth. The per-task reviews are intent.** Per-task code reviews describe per-task intent. You review **the cumulative phase diff**. Run the tests yourself. Open the files yourself. A green column of task reviews does not mean the phase is green. If a sentence in your review would read identically whether you had run the cumulative diff or not, delete it.
- **No copy-paste from the Phase Plan, per-task handoffs, or per-task reviews.** Your unique value is the cumulative view — summarizing upstream docs does not produce it.
- Task reviews already vetted each commit in isolation. Your job is to see what they couldn't — the seams between tasks.
- Skepticism is required, not optional. Four green task reviews do not equal a green phase.
- Every finding must include a concrete fix — never flag a problem without offering a path forward.
- Use binary assessments for checklist cells: ✅ pass, ⚠️ concern, ❌ fail. Use the tiered status enum (`on-track | drift | regression`) for per-requirement audit rows.
- **Finding IDs & evidence** are mandatory per the [SKILL.md](../SKILL.md) Finding-ID Scheme and Evidence Contract. Every finding row carries `F-N`, `File:Line`, and concrete `Evidence`. Phase-scope quality findings additionally carry a `Seam / Scope` pointer (e.g., `T1↔T3`).

## Inputs

Phase Review reads only the inputs below — do NOT load the Master Plan (its content is inlined in the Phase Plan's `**Requirements:**` line and the per-task handoffs; see the tag-resolution note).

| Input | Source | Description |
|-------|--------|-------------|
| Requirements | `{NAME}-REQUIREMENTS.md` | FR/NFR/AD/DD ledger. Source for the per-requirement audit table. |
| Phase Plan | `{NAME}-PHASE-{NN}-{TITLE}.md` | Exit criteria, task outline, and `**Requirements:**` line listing the FR/NFR/AD/DD tags scoped to this phase. |
| `phase_first_sha` | Spawn context | First task's initial commit. `null` when auto-commit is off. |
| `phase_head_sha` | Spawn context | Last committed SHA of the phase (corrective-aware). `null` when auto-commit is off. |
| Cumulative diff | `git diff <phase_first_sha>~1..<phase_head_sha>` (fallback: `git diff HEAD` + untracked files when either SHA is null) | The actual change set under review — scope for both the conformance pass and the quality sweep. |
| Source Code | Files produced in this phase | Read only when the diff requires surrounding context. |

**Tag resolution.** Parse the Phase Plan's `**Requirements:**` line directly to get the list of FR/NFR/AD/DD tags scoped to this phase. Do not traverse Task Handoffs to union tags — the Phase Plan is the authoritative scope.

## Workflow

1. **Read the Phase Plan** — understand exit criteria, task outline, and the `**Requirements:**` line. Enumerate every FR/NFR/AD/DD tag listed there; each will get a row in the audit table.
2. **Read the Requirements doc** — look up each phase-scoped tag to understand what the phase collectively owes.
3. **Run the cumulative phase diff.** If both `phase_first_sha` and `phase_head_sha` are present, run `git diff <phase_first_sha>~1..<phase_head_sha>` and `git diff --stat <phase_first_sha>~1..<phase_head_sha>`. If either is `null`, fall back to `git diff HEAD` + `git diff --stat HEAD` and read any untracked files listed in the phase's Task Handoff File Targets. Capture the exact command(s) run and the `--stat` output verbatim — these populate the template's `## Scope` section. Obtain the diff read-only — never `git checkout <sha>` / `git switch` in the live worktree (see SKILL.md → Worktree Safety Charter).
4. **Run the tests and verify the build.** Do not accept "tests passed" from any per-task report on faith. Capture the exact command run and the output — including **named test results**, not just a count — for the template's `## Test Execution` section.
5. **Aggregate phase data for the summary sections (Iter 8 phase-summary consolidation)**:
   - Task Results: from commit-level outcomes observable in the diff.
   - Files Changed: aggregate from the cumulative diff (created vs modified counts + key paths).
   - Issues & Resolutions: task-scoped issues observable in the diff's history (including through retries).
   - Carry-Forward Items: concrete issues the next phase must handle.
6. **Conformance pass (first)** — the tiered per-requirement audit. For every phase-scoped FR/NFR/AD/DD tag from the Phase Plan's `**Requirements:**` line, evaluate the cumulative diff and write one audit-table row carrying `F-N`, `File:Line`, `Evidence`, status, severity, finding, and fix:
   - **`on-track`** — the phase's cumulative contribution to this requirement is correct for what the phase's slice was supposed to deliver. Does NOT mean the requirement is complete project-wide — just that this phase's slice is correct. Even on-track rows carry evidence.
   - **`drift`** — the cumulative diff deviates from what the Phase Plan says the phase should deliver (cross-task contract mismatch, missing integration, wrong behaviour at a task seam). Drift findings drive orchestrator mediation.
   - **`regression`** — the cumulative diff breaks something that previously worked (test failure, deleted export that other code imports, behaviour change outside the phase's declared scope). Regression findings drive orchestrator mediation and are flagged critical.

   Also verify each Phase Plan exit criterion against what's actually checked in. If a criterion isn't verifiable from the current codebase, mark it failed; do not infer.

   Use the 4-category checklist below as a secondary aggregate view — the audit table is the per-requirement source of truth. Do NOT re-verify per-task requirement conformance that was already covered at task scope; your unique value is what spans tasks.

7. **Quality sweep (second) — read the cumulative diff without the Phase Plan open.** Deliberately set the Phase Plan and per-task handoffs aside. Read the cumulative diff line by line. Don't trust that modules integrate because the per-task code reviews say they do — the reviews describe per-task intent, the diff shows how the tasks actually fit together. Find what slipped through the seams between tasks. Each finding is a new `F-N` row with `File:Line`, `Evidence`, and a `Seam / Scope` pointer (e.g., `T1↔T3`, `T2→T4`, or the affected file when within a single task's territory). **Lean quality checks** — each must be itemized with evidence (command run + result), even when clean:
   - **TODO / FIXME scan** — grep the cumulative diff for leftover placeholder markers. Record the grep command and output.
   - **Diff stat** — use the `git diff --stat` output captured in step 3. Flag any file that grew disproportionately across the phase.
   - **Orphaned scaffolding / dead-on-arrival exports** — for each new export introduced anywhere in the phase, grep across the phase diff for callers. Record command and result.
   - **Decomposition / file-size / single-responsibility** — flag any file or function whose growth outpaces the phase's stated scope.
   - **Cross-task contract drift** — a consumer in a later task whose call site doesn't match a producer's contract from an earlier task. Highest-value check at phase scope. Cite producer file:line and consumer file:line in the Evidence.
   - **Conflicting patterns** — two tasks solving similar problems differently; pattern divergence is a finding.

   After the table, write one short **falsification paragraph** (2-4 sentences) describing the cross-task evidence you looked for that would have flipped the verdict and confirming whether you found it. Mandatory even when there are zero findings.

8. **Apply verdict rules** (see Verdict Rules section below) — highest severity across both passes determines verdict. Set `exit_criteria_met` frontmatter field to `true` only when ALL exit criteria are verified as met; `false` otherwise. **The verdict line must cite the driving finding and exit-criteria status:** for `approved`, cite "no findings ≥ low severity; all audit rows on-track; all exit criteria met"; for `changes_requested` / `rejected`, name the driving `F-N`(s) and status, plus any unmet exit criterion.
9. **Fill in the output template** at [./template.md](./template.md) and save to `{PROJECT-DIR}/reports/{NAME}-PHASE-REVIEW-P{NN}-{TITLE}.md`.

## Stateless Contract (Iter 10/11)

Phase Review is **stateless**. You read the Phase Plan, the Requirements doc, and the cumulative diff. You do not read any prior phase review doc, prior corrective attempt, or prior orchestrator addendum. A phase iteration runs `phase_review` exactly once per iter-11's single-pass clause — a phase-scope corrective's own task-level code review completes the cycle. Treat the diff under review as the sole source of truth. Do not flag a change relative to a prior review as regression when the corrective flow explicitly reshaped the code.

## Conformance Checklist Categories

Aggregate health view for the secondary Integration Assessment table. The per-requirement audit is the primary source of truth.

- Integration (modules work together)
- Conflicts (no conflicting patterns)
- Contracts (honored across task boundaries)
- Orphaned code (no unused imports, dead code, leftover scaffolding)

## Code Smells

The following categories are starting points, not an exhaustive checklist. Look beyond these — novel issues are often the most important ones.

| Category | What to look for | Illustrative example |
|----------|-----------------|---------------------|
| Documentation drift | Code behaviour does not match documentation | README says the function returns a list, but code returns a single item |
| Null/undefined gaps | Missing null checks on data from external sources | API response field assumed to exist without validation |
| Defensive coding gaps | Missing error handling at system boundaries | No try/catch on file I/O or network calls |
| Silent failures | Errors caught but not surfaced or logged | Empty catch block swallows exception |
| Hardcoded values | Magic numbers, embedded paths, inline config | `timeout = 5000` with no named constant or config |
| Race conditions | Shared state accessed without synchronization | Concurrent file writes to the same path |
| Security boundaries | Unsanitized input, leaked secrets, missing auth | User input concatenated directly into a SQL query |
| Dead code | Unreachable branches, unused exports or imports | Exported function never imported anywhere |
| Implicit coupling | Hidden dependencies between modules | Module A directly reads a file owned by Module B |
| Resource leaks | Opened handles, streams, or connections never closed | File stream opened in function but no cleanup on error path |
| Cross-task contract drift | A consumer in a later task doesn't match a producer's contract from an earlier task | T1 changes a function's return type to `Promise<T>`; T3 still awaits synchronously |
| Dead-on-arrival exports | Exports added in one task that no other task in the phase imports | T1 adds `export function helperX`; grep across T2–T4 diffs shows zero imports |
| Approved-but-integrated-wrong | Every task review was approved, but the cumulative diff reveals the tasks don't fit together | T1 returns ISO date strings; T3 parses dates expecting Unix timestamps — each task review passed against its own handoff |
| Decomposition / file-size | A single file or function grows past reasonable density for the phase's cumulative scope | A helper file accumulates 600 lines across four tasks with no refactor |
| Single-responsibility | A module picks up orthogonal concerns as tasks layer on | The auth module starts doing date formatting in task 3 |
| TODO/FIXME left behind | Placeholder markers committed without follow-up tracking | `// TODO: handle null case` with no tracking issue |

## Quality Standards

- Code compiles and all tests pass — zero tolerance for build or test failures.
- No regressions in existing functionality.
- Error handling covers realistic failure modes, not just the happy path.
- Public APIs and exported interfaces are documented.
- No security vulnerabilities (injection, authentication gaps, exposed secrets).
- Per-task code reviews are evidence, not verdict. A phase of approved task reviews does not mean the phase is approved. If the cumulative diff reveals something every task reviewer missed, that's on you to catch.

## Verdict Rules

The highest-severity finding across both passes (conformance + quality sweep) determines the overall verdict. Verdict enum is unchanged from prior iterations.

| Verdict | When to Apply |
|---------|---------------|
| `approved` | No issues found, or only low-severity findings (cosmetic, style), AND every requirement row is `on-track`, AND every exit criterion is met. |
| `changes_requested` | At least one medium-severity finding (functional issue, missing coverage), OR at least one `drift` row in the audit table, OR a `regression` row classified medium or low severity (mechanical corrective: bounded one-or-two-file fix), OR any exit criterion unmet. |
| `rejected` | At least one high-severity finding (security vulnerability, data loss risk, architectural violation), OR a `regression` row classified **high-severity** (production behavior broken, contract or API regression, irrecoverable data state, regression whose corrective scope cannot be bounded). |

- **Severity** levels: **low** (cosmetic, style), **medium** (functional issue, missing coverage), **high** (security vulnerability, data loss risk, architectural violation), **none** (no findings).
- **Status** semantics (audit table): `on-track` is informational only. `drift` always escalates to at least `changes_requested`. `regression` escalates per severity: medium/low regressions route through orchestrator mediation as a corrective task (`changes_requested`); high-severity regressions halt the phase (`rejected`). Regression severity is `high` by default; downgrade only when the corrective is bounded and mechanical, and cite the bounded fix in the finding row.
- Quality-sweep findings use the same severity levels as conformance findings and CAN escalate the verdict.

## Output

- **Template**: [./template.md](./template.md)
- **Save path**: `{PROJECT-DIR}/reports/{NAME}-PHASE-REVIEW-P{NN}-{TITLE}.md`
