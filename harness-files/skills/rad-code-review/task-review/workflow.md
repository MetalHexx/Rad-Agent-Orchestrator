# Task Review

Self-contained workflow for task-level code review (Action #4, `spawn_code_reviewer`). Do not load other review docs — everything you need is below.

## Review Mindset

- **The diff is truth. The handoff is intent.** The implementer's report — including Execution Notes — is not evidence. "Tests passed," "acceptance criteria met," "requirement X implemented" describe intent. You review **the diff**. Run the tests yourself. Open the files yourself. If a sentence in your review would read identically whether you had run the diff or not, delete it.
- **No copy-paste from the Task Handoff.** Summarizing prescribed content is not review output. When the handoff prescribes file content verbatim, show the comparison mechanism (diff command, byte range), not a restatement of the prescription.
- Skepticism is required, not optional. Reviewers who assume good work miss real bugs.
- Every finding must include a concrete fix — never flag a problem without offering a path forward.
- Before recommending a new feature, test, or abstraction, verify it's actually needed. Grep the codebase for real usage. Don't invent work.
- Use binary assessments for checklist cells: ✅ pass, ⚠️ concern, ❌ fail. Use the tiered status enum (`on-track | drift | regression`) for per-requirement audit rows.
- **Finding IDs & evidence** are mandatory per the [SKILL.md](../SKILL.md) Finding-ID Scheme and Evidence Contract. Every finding row carries `F-N`, `File:Line`, and concrete `Evidence`.

## Inputs

Task Review reads only the inputs below — do NOT load the Requirements doc, Master Plan, Phase Plan, or sibling Task Handoffs. The Task Handoff is the complete conformance contract; the diff is the scope for both passes.

| Input | Source | Description |
|-------|--------|-------------|
| Task Handoff | `{NAME}-TASK-P{NN}-T{NN}-{TITLE}.md` | Task requirements, contracts, acceptance criteria, and **File Targets list** (gated in workflow step 3). Inlines every FR/NFR/AD/DD tag scoped to this task. This is the complete conformance contract. |
| `head_sha` | Spawn context | Commit hash of the just-made task commit. `null` when `source_control.auto_commit` is `never` or no commit has been made. |
| Diff | `git diff <head_sha>~1..<head_sha>` (or `git diff HEAD` + untracked files when `head_sha` is null) | The actual change under review. Scope for both the conformance pass and the quality sweep. Always run `git diff --stat` alongside — its exact output populates the template's `## Scope` section. |
| Source files | Files listed in Task Handoff's File Targets | Read only when the diff requires surrounding context to verify a finding. |

## Workflow

1. **Read the Task Handoff** — this is the complete conformance contract. Every FR-N, NFR-N, AD-N, and DD-N element scoped to this task is inlined there. Enumerate the requirement IDs — you will audit each one. Also enumerate the **File Targets** list — you will gate against it in step 3.
2. **Scope the diff.** If `head_sha` is provided in spawn context, run `git diff <head_sha>~1..<head_sha>` and `git diff --stat <head_sha>~1..<head_sha>`. Otherwise (auto-commit is off) run `git diff HEAD` + `git diff --stat HEAD` and read any untracked files listed in the Task Handoff's File Targets. Capture the exact command(s) run, the `--stat` output, and any untracked-file paths — these populate the `## Scope` section of the template. Obtain the diff read-only — never `git checkout <sha>` / `git switch` in the live worktree (see SKILL.md → Worktree Safety Charter).
3. **File Targets gate.** Enumerate the File Targets declared in the Task Handoff. Confirm each declared target was modified (or created) in the diff. Flag any declared target **not** modified, and any file **outside** the declared File Targets that was modified (scope creep). These become findings if present.
4. **Run the tests and verify the build.** Do not accept "tests passed" from the Task Handoff or any prior report on faith. Execute the test runner yourself. Capture the exact command run and the output — including **named test results**, not just a count — for the `## Test Execution` section of the template. "8 tests pass" is not acceptable; "8/8 pass: `colorize > …`, `cli > positional argument …`, …" is.
5. **Conformance pass (first)** — the tiered per-requirement audit. For every FR/NFR/AD/DD tag inlined in the Task Handoff, evaluate whether the diff delivers what this task owes and write one audit-table row carrying `F-N`, `File:Line`, `Evidence`, status, severity, finding, and fix:
   - **`on-track`** — the diff's contribution to this requirement is correct for what the task's slice was supposed to deliver. (On-track does NOT mean the requirement is fully complete project-wide — just that this task's slice is correct. A requirement may remain on-track across several tasks before final review marks it `met`.) Even on-track rows carry evidence — a file range or representative code quote proving the slice is correct.
   - **`drift`** — the diff deviates from what the Task Handoff says the task should deliver for this requirement (wrong contract, missing piece, wrong behaviour). Drift findings drive orchestrator mediation.
   - **`regression`** — the diff breaks something that previously worked (test failure, deleted export that sibling code imports, behaviour change outside the task's declared scope). Regression findings drive orchestrator mediation; severity is assigned per the finding's impact (see Verdict Rules). Regressions are **high-severity by default** — assign `high` whenever the impact is unclear or you cannot personally bound the corrective. Downgrade to `medium` or `low` only when you can name the exact one-or-two-file fix and the corrective is mechanical (snapshot/path/shape adjustment, not a behavior or contract change).

   Use the 7-category conformance checklist (below) as a secondary aggregate view — the audit table is the per-requirement source of truth.

   Read full files from File Targets when the diff alone is insufficient to confirm conformance (e.g., to verify an export survived, a signature is unchanged, or a previously-passing test still passes).

6. **Quality sweep (second) — read the diff without the handoff open.** Deliberately set the Task Handoff aside. Read the diff line by line independent of prescribed intent. Find what the implementer missed: bugs, edge cases, silent failures, defensive gaps. Apply code-smell detection from the table below. Each quality-sweep finding is a new `F-N` row with the same evidence contract (`File:Line`, `Evidence`). **Lean quality checks** to run explicitly — each must be itemized with evidence (command run + result), even when clean:
   - **TODO / FIXME scan** — grep the diff for `TODO`, `FIXME`, `HACK`, `XXX`. Record the grep command and its output (empty or hits).
   - **Diff stat** — use the exact `git diff --stat` output captured in step 2. Flag any file gaining disproportionate size for the stated task; decomposition / single-responsibility concerns follow.
   - **Orphaned scaffolding** — grep the codebase for callers of each new export. Record the grep command and result.
   - **Decomposition / file-size / single-responsibility** — when a function or file grows past reasonable density, evaluate whether the task's intent justifies the bloat or whether decomposition is warranted.

   After the table, write one short **falsification paragraph** (2-4 sentences) describing the evidence you looked for that would have flipped the verdict and confirming that evidence was absent (or present and cited). This is your independence declaration — it is mandatory, even when there are zero findings.

7. **Apply verdict rules** (see Verdict Rules section below). The verdict enum is unchanged: `approved | changes_requested | rejected`. Highest severity across both passes determines the verdict. **The verdict line must cite the driving finding:** for `approved`, cite "no findings ≥ low severity; all audit rows on-track"; for `changes_requested` / `rejected`, name the driving `F-N`(s) and status.

8. **Fill in the output template** at [./template.md](./template.md) and save based on corrective status:
   - Normal (first-time): `{PROJECT-DIR}/reports/{NAME}-CODE-REVIEW-P{NN}-T{NN}-{TITLE}.md`
   - Task-scope corrective: `{PROJECT-DIR}/reports/{NAME}-CODE-REVIEW-P{NN}-T{NN}-{TITLE}-C{corrective_index}.md`
   - Phase-scope corrective: `{PROJECT-DIR}/reports/{NAME}-CODE-REVIEW-P{NN}-PHASE-C{corrective_index}.md`

   **Derivation rule.** Read `task_id` from the spawn context. When `task_id` has the form `P{NN}-T{NN}` (e.g., `P01-T02`), use the task-scope filename form. When `task_id` has the form `P{NN}-PHASE` (e.g., `P01-PHASE`), use the phase-scope sentinel form — the review covers a phase-scope corrective, not a single task. The `-C{N}` suffix is appended immediately before `.md`. Read `corrective_index` from the event context — do not query the filesystem. The original (non-corrective) review is preserved, not overwritten. (See `orchestration/references/document-conventions.md` → "Corrective Filename Suffix" for the shared pattern.)

## Stateless Contract (Iter 10/11)

Task Review is **stateless**. You read the Task Handoff and the diff. You do not read any prior review doc, prior corrective attempt, or prior orchestrator addendum. If this is a corrective re-review, the coder authored the code against a self-contained corrective Task Handoff — the same inputs apply. Treat the diff under review as the sole source of truth. Do not flag a deviation from the original handoff as regression when the current (possibly corrective) handoff redefines the contract.

## Conformance Checklist Categories

These are the high-level categories for the secondary Conformance Checklist table in the template. The per-requirement audit is the primary source of truth; the category checklist is an aggregate health view.

- Architectural consistency
- Design consistency
- Code quality
- Test coverage
- Error handling
- Accessibility
- Security

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
| Scope creep | Changes touching files outside the Task Handoff's File Targets | Edit to an unrelated helper "while I was there" |
| Undocumented diff | Lines changed without a purpose tied to the task objective | Refactor of formatting or naming mixed into a functional change |
| Decomposition / file-size | A single file or function grows past reasonable density for the task's stated scope | A 40-line helper balloons to 250 lines in a task that was supposed to add one method |
| Single-responsibility | A module picks up orthogonal concerns alongside its primary job | Config loader starts doing schema validation inline |
| TODO/FIXME left behind | Placeholder markers committed without follow-up tracking | `// TODO: handle null case` with no tracking issue |
| Dead-on-arrival exports | New exports no caller imports | `export function helperX` added but never referenced |

## Quality Standards

- Code compiles and all tests pass — zero tolerance for build or test failures.
- No regressions in existing functionality.
- Error handling covers realistic failure modes, not just the happy path.
- Public APIs and exported interfaces are documented.
- No security vulnerabilities (injection, authentication gaps, exposed secrets).

## Verdict Rules

The highest-severity finding across both passes (conformance + quality sweep) determines the overall verdict. Verdict enum is unchanged from prior iterations.

| Verdict | When to Apply |
|---------|---------------|
| `approved` | No issues found, or only low-severity findings (cosmetic, style), AND every requirement row is `on-track`. |
| `changes_requested` | At least one medium-severity finding (functional issue, missing coverage), OR at least one `drift` row in the audit table, OR a `regression` row classified medium or low severity (mechanical corrective: pre-existing test learns a new shape, snapshot mismatch, refactor side-effect with a contained one-or-two-file fix). |
| `rejected` | At least one high-severity finding (security vulnerability, data loss risk, architectural violation), OR a `regression` row classified **high-severity** (production behavior broken, contract or API regression, irrecoverable data state, regression whose corrective scope you cannot bound). |

- **Severity** levels: **low** (cosmetic, style), **medium** (functional issue, missing coverage), **high** (security vulnerability, data loss risk, architectural violation), **none** (no findings). The `severity` frontmatter field records the highest finding severity across both passes, or `none` when no findings were raised.
- **Status** semantics (audit table): `on-track` is informational only — it does not escalate the verdict. `drift` always escalates to at least `changes_requested`. `regression` escalates per its severity: medium/low regressions escalate to `changes_requested` (routed through orchestrator mediation as a corrective task), high-severity regressions escalate to `rejected`. Regression severity is `high` by default; downgrade only when the corrective is bounded and mechanical, and cite the bounded fix in the finding row.
- Quality-sweep findings use the same severity levels as conformance findings and CAN escalate the verdict.

## Output

- **Template**: [./template.md](./template.md)
- **Save path**:
  - Normal: `{PROJECT-DIR}/reports/{NAME}-CODE-REVIEW-P{NN}-T{NN}-{TITLE}.md`
  - Task-scope corrective: `{PROJECT-DIR}/reports/{NAME}-CODE-REVIEW-P{NN}-T{NN}-{TITLE}-C{corrective_index}.md`
  - Phase-scope corrective: `{PROJECT-DIR}/reports/{NAME}-CODE-REVIEW-P{NN}-PHASE-C{corrective_index}.md` (when `task_id` matches `P{NN}-PHASE`)
