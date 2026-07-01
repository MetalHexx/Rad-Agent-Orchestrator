# Corrective Playbook

Orchestrator-only mediation guide. Load this document at the start of every corrective cycle (task-scope or phase-scope). It is self-contained — no other reference document is required to execute a mediation cycle beyond the review doc, the project's Requirements file, the Phase Plan (for phase-scope cycles), and the original Task Handoff (task-scope) or the phase's Task Handoffs (phase-scope).

---

## Tiered Conformance Model

Before reading any finding, understand what the reviewer's status enum actually means at the scope you are mediating — the same row shape carries different implications at task, phase, and final scope.

### Scope-aware status enum

| Scope | Status Enum | Meaning |
|-------|-------------|---------|
| Task (`code_review_completed`) | `on-track \| drift \| regression` | The reviewer audited each FR/NFR/AD/DD tag inlined in the Task Handoff. On-track = the task's slice is correct; drift = the task's slice deviates from the handoff's contract; regression = the task broke something that previously worked. |
| Phase (`phase_review_completed`) | `on-track \| drift \| regression` | The reviewer audited each FR/NFR/AD/DD tag from the Phase Plan's `**Requirements:**` line against the cumulative phase diff. On-track = the phase's cumulative slice is correct; drift = cumulative deviation (typically cross-task contract drift); regression = phase broke something that previously worked. |
| Final (`final_review_completed`) | `met \| missing` | The reviewer audited every FR/NFR/AD/DD tag in the Requirements doc against the cumulative project diff. Strict — the project either delivers the requirement or it does not. |

### What on-track means at task and phase scope

On-track is **informational only** — it tells you the reviewed slice of the requirement is correct. It does **not** mean the requirement is complete project-wide. A requirement can remain on-track across several tasks before it becomes `met` at final scope. On-track rows therefore carry severity `none` in almost all cases and do not escalate the verdict.

Rare exception: if the task or phase under review was supposed to **fully satisfy** a requirement (i.e., the Task Handoff or Phase Plan said "deliver FR-3 in full"), but the reviewer marked the row on-track with severity `low` because the slice is cleanly built but incomplete, treat this as drift during mediation. The orchestrator reads the handoff / phase plan to decide whether the scope owed completion — the reviewer may have been conservative with the status. Cite this reasoning explicitly in the addendum.

### How drift differs from regression

| Status | Meaning | Orchestrator Action |
|--------|---------|---------------------|
| `drift` | The diff deviates from what the scope was supposed to deliver (wrong contract, missing piece, wrong behaviour at a task seam). | **Action** unless cross-artifact scan shows the piece legitimately belongs elsewhere. Bounded corrective handoff. |
| `regression` | The diff breaks something that previously worked (test failure, deleted export that other code imports, behaviour change outside the declared scope). | **Action + flagged critical in the corrective preamble.** The coder needs to know this is a repair of a break, not a forward-progress increment. |

### Severity is orthogonal to status

The severity column records the **impact** of the finding; the status column records the **relationship to the scope contract**. A low-severity drift row is still drift (action it). A high-severity on-track row is rare but possible (a quality-sweep finding that happens to land on a scoped requirement, e.g., a security concern in a file implementing FR-3). Evaluate each independently during judgment.

---

## Finding Disposition by Status

For each row in the review's audit table, the disposition is preselected by the status enum — but you validate the judgment against the sources before committing.

| Status | Default Disposition | When to Override |
|--------|--------------------|--------------------|
| `on-track` (task/phase) | **decline** — "tracking for later scope" | Override to `action` only when the scope under review was supposed to fully satisfy the requirement but the reviewer marked on-track-but-incomplete. Cite the Task Handoff / Phase Plan language that owed completion. Also override to `action` when a quality-sweep finding with severity `high` lands on this row — severity `high` trumps informational status regardless of scope completeness. |
| `drift` (task/phase) | **action** | Override to `decline` only when cross-artifact scan proves the piece legitimately belongs to a later phase or another task's contract. Cite the Master Plan or sibling Task Handoff. |
| `regression` (task/phase) | **action + flagged critical** | Override to `decline` only when the "break" is a deliberate planned deletion (very rare). Confirm against the Phase Plan / Requirements doc. |
| `met` (final) | n/a — no mediation at final scope | — |
| `missing` (final) | n/a — no mediation at final scope | — |

### Disposition addendum format

Each Finding Dispositions row must cite **(tier, reasoning)** — not just `action` / `decline`. Example rows for a task-scope mediation:

```markdown
| Finding ID | Disposition | Reason |
|------------|-------------|--------|
| F-1 | action (drift) | Return-type mismatch on `getColors()` — Task Handoff FR-2 explicitly specifies `string[]`; diff returns `Promise<string[]>`. Bounded to src/colors.ts. |
| F-2 | action (regression) | Deleted export `formatDate` imported by sibling module — break traceable to T2 diff line 42; fix: restore export or update sibling call site. Flagged critical. |
| F-3 | decline (on-track) | FR-5 is owned by P02-T03 per Master Plan cross-reference; this task's slice is correct. Tracking for later scope. |
```

The status enum appears in parentheses after the disposition verb. The Reason column explains **why** the disposition is correct — requirement traceability, scope boundary, cross-artifact evidence. Never reference a prior attempt's code in the reason — the addendum records orchestrator judgment, not code history.

### On-track findings and the corrective handoff

When all drift and regression findings are actioned but on-track rows are also present, **do NOT** include the on-track rows in the corrective handoff's scope. On-track is tracking-only; the handoff should only enumerate the actioned findings (drift + regression). Keep the corrective narrow — a coder working against the handoff should fix exactly what drifted, not pick up work that was correctly scoped to a later task.

---

## When the Orchestrator Engages

Mediation fires **only** on a verdict from the reviewer. The full decision tree:

| Raw Verdict | Orchestrator Action |
|-------------|---------------------|
| `changes_requested` | Enter mediation (this playbook). Author addendum + corrective handoff if any finding is actioned. Signal `code_review_completed` after mediation completes. |
| `approved` | Propagate to the pipeline untouched. No addendum. No mediation. |
| `rejected` | Halt immediately. No addendum. No mediation. |

The orchestrator **never** flips an `approved` verdict to `changes_requested`. Direction is one-way: mediation can resolve `changes_requested` → `approved` (when all findings are declined), but never the reverse.

---

## Scope: Task vs. Phase

Mediation fires identically on task-scope reviews (`code_review_completed`) and phase-scope reviews (`phase_review_completed`). The per-finding judgment, addendum shape, additive frontmatter, corrective Task Handoff authoring, and budget enforcement are the same at both scopes. The differences are small:

| Aspect | Task scope | Phase scope |
|--------|-----------|-------------|
| Trigger event | `code_review_completed` | `phase_review_completed` |
| Source inputs for judgment | Task Handoff, Requirements | Phase Plan, Requirements, all Task Handoffs in the phase, cumulative phase diff |
| Corrective handoff filename | `tasks/{NAME}-TASK-P{NN}-T{NN}-{TITLE}-C{N}.md` | `tasks/{NAME}-TASK-P{NN}-PHASE-C{N}.md` |
| Budget source array | `taskIter.corrective_tasks` | `phaseIter.corrective_tasks` |
| Frontmatter `corrective_scope` | `"task"` | `"phase"` |

**Hosting iteration derivation.** The hosting iteration is derived automatically from where the reviewed node lives in state — the orchestrator does not author a scope hint. For `phase_review_completed` the host is always the current phase iteration. For `code_review_completed`, the mutation uses **ancestor-derivation**: if the completed `code_review` node lives under an active entry of `phaseIter.corrective_tasks[*].nodes`, the new corrective appends to `phaseIter.corrective_tasks` (corrective-of-a-phase-scope-corrective); otherwise it appends to `taskIter.corrective_tasks` (task scope, or corrective-of-a-task-scope-corrective). The orchestrator treats all findings the same way regardless of which iteration hosts them — the routing is the engine's job, not yours.

**Single-pass phase_review.** `phase_review` runs exactly once per phase iteration. After a phase-scope corrective's own task-level code review approves, the phase iteration completes directly — the pipeline does not re-dispatch `spawn_phase_reviewer`.

---

## Budget Check — Do This First

Before reading any findings, check the retry budget:

1. Read `max_retries_per_task` from `orchestration.yml` (default: `5` if the field is absent).
2. Count `corrective_tasks.length` in the active task iteration in `state.json`.
3. If `corrective_tasks.length >= max_retries_per_task`, the budget is **exhausted**.

**Budget-exhausted behavior**: do NOT author a corrective handoff. Write the addendum with `Effective Outcome: changes_requested` and no `Corrective Handoff` line. Set `effective_outcome: changes_requested` in frontmatter (no `corrective_handoff_path`). Then surface a clear operator-facing halt message explaining the budget is exhausted. The mutation will convert this into a clean pipeline halt.

**Budget validity is orthogonal to finding validity.** Never decline a valid finding because the budget is low. If budget is blown AND the findings are valid, produce an honest halt — not a declined addendum.

---

## Per-Finding Judgment

Work through each finding in the review doc individually. For each:

### What the review doc guarantees

The rad-code-review skill (`${SKILLS_ROOT}/rad-code-review/SKILL.md`, Evidence Contract + Finding-ID Scheme) structurally guarantees the fields below on every review doc. You key your judgment off these fields — if any are missing or inconsistent, the review is structurally invalid and mediation cannot proceed:

- **`F-N` stable finding ID** on every row of every finding-bearing table (per-requirement audit + quality sweep). IDs are unique within the review doc and reset to `F-1` per doc (corrective reviews start fresh). Your disposition table keys on these IDs.
- **`File:Line`** — concrete source pointer on every finding. Use it to read the actual source when verifying the reviewer's claim.
- **`Evidence`** — quoted code, diff excerpt, test output, or grep result. If the reviewer wrote paraphrase instead of evidence, treat the row as under-supported — verify independently before actioning.
- **`Requirement`** column on audit rows (and optionally on quality-sweep rows). Use it directly for requirement traceability; don't re-derive.
- **`## Scope` section** — captures the exact `git diff` command run and `--stat` output, letting you confirm the reviewer scoped the correct commit range.
- **`## Test Execution` section** — captures the exact test command run and named test output. Use it to resolve test-related findings without re-running the suite.
- **Falsification paragraph** at the end of the quality sweep — documents the negative case the reviewer probed. Useful context when deciding whether a zero-finding review is trustworthy.

**If the review doc is missing `F-N`, `File:Line`, or `Evidence`**, do not paper over the gap in your addendum. Flag the structural defect and escalate — a reviewer who skipped the evidence contract produced output the mediation loop cannot consume.

### Inputs to gather before judging

1. **File and line reference** — read the actual source at the `File:Line` the reviewer cited. Read the full function/block, not just the cited line.
2. **Requirement traceability** — the reviewer's `Requirement` column gives you the FR/NFR/AD/DD ID directly. Confirm it against `{NAME}-REQUIREMENTS.md`. If the finding cites no requirement ID (quality-sweep with `—`), check whether the issue is traceable to an acceptance criterion in the Task Handoff.
3. **Task Handoff section** — re-read the relevant section of the Task Handoff (Acceptance Criteria, File Targets, Implementation Notes).
4. **Source or test in question** — read the full function/block, not just the cited line, to verify the claim is accurate. The reviewer's `Evidence` column should match what you see in the source; if it doesn't, the finding may be a misread (decline criterion).

### Cross-artifact scan before declining

Before marking any finding as `decline`, scan:

- **Sibling Task Handoffs** — does a concurrent or adjacent task own this piece of work?
- **Master Plan** — is this piece explicitly assigned to a later phase or task?
- **Prior-phase artifacts** — was this supposed to be delivered earlier and is now genuinely missing?

If the scan shows this task's contract owed the piece, change the disposition to `action`. If the piece legitimately belongs to a future phase or task, decline with the cross-artifact rationale in the Reason column.

**Repo-dimension note (FR-19).** When a finding flags work that landed outside the task's declared `**Target repos:**`, apply the same cross-artifact scan with a repo lens: if the coder touched a repo not listed in the handoff's `**Target repos:**`, first check whether the Master Plan or a sibling Task Handoff assigns that repo-level change to a different task or phase. If a legitimate owner exists elsewhere, that is a pivot — decline with the repo rationale. If no legitimate owner exists and the change was required to satisfy the task's inlined requirement, that is overreach — action it as drift, bounding the corrective to the declared target repos.

### Action when

Disposition is `action` when **all** of the following hold:

- The reviewer correctly identifies a real deviation (the code does not match what it should do).
- The fix is bounded to this task's scope — it touches only files listed in the Task Handoff's File Targets, or files demonstrably required to satisfy the task's requirements.
- The finding traces to an acceptance criterion or inlined requirement the task owes.

### Decline when

Disposition is `decline` when **any** of the following hold:

- The finding is outside this task's scope (different phase, different task's contract, or a future iteration's concern).
- The finding references a requirement not inlined in the Task Handoff.
- The finding asks for speculative improvements, performance optimizations, or architectural enhancements not required by any inlined requirement.
- The reviewer misread the code — the cited behavior is not what the code actually does.

### Default bias: action over decline

When in doubt, lean toward `action`. Reviewer authority is the baseline. Decline only when you have clear evidence the finding is out-of-scope, inaccurate, or speculative.

---

## Phase-Scope Mediation

Fires on `phase_review_completed` with raw `verdict: changes_requested`. The core flow — budget check, per-finding judgment, addendum authoring, corrective handoff authoring, signaling — matches task scope. The deltas below cover the differences.

### When it fires

Only after a phase reviewer emits `verdict: changes_requested`. Approved and rejected phase verdicts bypass mediation and propagate untouched (rejected halts the pipeline; approved advances past the phase).

### Per-finding judgment inputs

Phase reviewers flag cross-task issues — contract drift at task seams, orphan exports, conflicting patterns, unmet exit criteria. For each finding, gather:

1. **File and line reference** — read the actual source at that location.
2. **Requirement traceability** — look up the referenced requirement IDs (FR/NFR/AD/DD) in `{NAME}-REQUIREMENTS.md`.
3. **Phase Plan exit criteria** — re-read the Phase Plan's exit criteria section. A phase-scope finding should trace either to an exit criterion or to a requirement the phase collectively owes.
4. **Task Handoffs in the phase** — re-read the Acceptance Criteria and File Targets of the task(s) implicated. The finding may cross a seam between two tasks.
5. **Cumulative phase diff** — `git diff <phase_first_sha>~1..<phase_head_sha>` (fallback: `git diff HEAD` when SHAs are null). Verify the cited behaviour against the actual diff, not against per-task handoff intent.

### Cross-artifact scan emphasis

Phase reviewers naturally raise cross-task findings, and the cross-artifact scan carries more weight here than at task scope. Before declining, confirm the piece isn't owned by a later phase in the Master Plan. If the phase's collective contract owed the piece, the finding is `action`.

### Action vs. decline criteria

Same bar as task scope — action when the finding cites a real deviation, traces to an inlined requirement or phase exit criterion, and a bounded fix exists; decline when out-of-scope, speculative, or factually incorrect. Default bias remains action over decline.

### Single-pass phase_review clause

`phase_review` runs exactly once per phase iteration. Once the phase-scope corrective's task-level code review approves, the phase iteration completes — the pipeline does **not** re-dispatch `spawn_phase_reviewer`. There is no phase-review corrective filename form; the `-C{N}` sentinel lives on the corrective Task Handoff and on the task-level code review filename only.

### Budget banner

The `Attempt N of M` banner uses `phaseIter.corrective_tasks.length` (not `taskIter.corrective_tasks.length`): N = `phaseIter.corrective_tasks.length + 1`, M = `max_retries_per_task`. Budget exhaustion behaviour is identical to task scope — addendum + no handoff + clean halt.

### Corrective handoff filename

```
tasks/{NAME}-TASK-P{NN}-PHASE-C{N}.md
```

The `PHASE` token replaces the `T{NN}-{TITLE}` segment. N = `phaseIter.corrective_tasks.length + 1` at authoring time.

### Frontmatter

Same core shape as the task-scope corrective handoff. Two fields differ:

```yaml
corrective_scope: phase
```

`corrective_index` is 1-based against `phaseIter.corrective_tasks.length + 1`. No `task` field is required — the corrective applies to the whole phase, not a single task.

### Handoff body

Same self-contained preamble-then-steps shape as task scope. The preamble describes the phase-scope intent (what the phase collectively owes — integration, cross-task contracts, exit criteria) and the steps enumerate the actioned findings as concrete implementation instructions. No references to prior reviews, prior corrective attempts, or delta reasoning. A coder reading the handoff should execute the work without loading the phase review doc or any task handoff.

### Signaling

After authoring the addendum and (when applicable) the corrective handoff, signal `phase_review_completed --doc-path <path-to-phase-review-doc>`. The pipeline reads the phase review doc's frontmatter — `effective_outcome` and `corrective_handoff_path` — to birth the corrective or advance the pipeline normally.

---

## Verify Before Echo (corrective commit signals)

**Scope:** the mutating `task_completed` signal on a corrective path — the one
that records a commit hash. Commit is folded into the task, so a corrective
task's own `task_completed` carries its hash. Not all signals; only this
corrective commit echo.

When you are about to signal `task_completed` for a corrective task, the
`--phase`/`--task`/`--branch` you echo come from `data.context`. On a corrective
path that context can be stale. Before emitting the mutating signal:

1. **Read `state.json`.** Locate the node(s) carrying `status: in_progress`.
2. **Confirm the active node.** On a phase-scope corrective the active node is
   the last entry of the active phase's `corrective_tasks` (its `task_executor`
   sub-node is `in_progress`); the echoed context should carry that phase's
   identity with the phase-scope task sentinel (`task_number: null`,
   `task_id: "P{NN}-PHASE"`).
3. **Confirm the identifiers address that node.** If `--phase`/`--task` do not
   resolve to the `in_progress` node, **do not emit `task_completed`.** Inspect
   and correct first — re-derive the correct identifiers from the markers, or
   re-signal `start` (non-mutating) to let the engine recompute the action
   context.
4. **Never echo a context you have flagged as stale into a mutation.** A
   finalized commit hash is immutable; the engine refuses a stale echo — and a
   commit reported off its intended branch — with `ok: false`, but the rule is
   to catch it before the signal, not rely on the engine's catch-net.

This is a standing rule: a future orchestrator agent facing the same
stale-context signal halts and verifies rather than echoing into a mutation.

---

## Addendum Shape

Append a `## Orchestrator Addendum` section to the **existing** review doc. Write it after all existing content. Do not rewrite or restructure the review doc body.

```markdown
## Orchestrator Addendum

**Attempt N of M**
(N = corrective_tasks.length + 1, M = max_retries_per_task)

### Finding Dispositions

| Finding ID | Disposition | Reason |
|------------|-------------|--------|
| F-1 | action | Ordering mismatch traces to FR-2 acceptance criterion. Fix bounded to src/colors.js. |
| F-2 | decline | References NFR-4 (performance), not inlined in this task's handoff. Future-phase concern. |

Effective Outcome: changes_requested
Corrective Handoff: tasks/{NAME}-TASK-P{NN}-T{NN}-{TITLE}-C{N}.md
```

**Rules:**

- `N` (attempt number) = `corrective_tasks.length + 1` at the time of authoring. On first mediation cycle, `corrective_tasks` is empty, so N = 1.
- `M` = `max_retries_per_task` from `orchestration.yml`.
- The disposition table must have one row per finding in the review.
- **Reason column**: focus on requirement traceability and scope boundary — "traces to FR-N," "outside this task's File Targets," "belongs to P02-T03 per cross-artifact scan." **Do not reference the prior attempt's implementation** (no "the reviewer noted a regression from …", no "the previous coder missed …"). The addendum explains the orchestrator's judgment, not the code's history.
- `Effective Outcome` line is always present.
- `Corrective Handoff` line is present **only** when `effective_outcome === 'changes_requested'` **AND the retry budget is not exhausted** (at least one finding is actioned and a handoff is being authored).
- When all findings are declined, write `Effective Outcome: approved` and omit the `Corrective Handoff` line.
- **On budget exhaustion**: `effective_outcome` remains `changes_requested` (there are still valid findings) but the `Corrective Handoff` line is **omitted** — the mutation converts this combination into a clean pipeline halt. See the Budget Check section above.
- Write this addendum on **every** mediation cycle, including decline-all cycles. Never write an addendum on raw-approved reviews.

### Additive frontmatter

After writing the addendum, add these fields to the **existing** frontmatter block of the review doc. Do not rewrite the frontmatter — append the new fields:

```yaml
orchestrator_mediated: true
effective_outcome: changes_requested   # or approved
corrective_handoff_path: tasks/{NAME}-TASK-P{NN}-T{NN}-{TITLE}-C{N}.md  # omit if effective_outcome === approved
```

`corrective_handoff_path` is present **if and only if** `effective_outcome === 'changes_requested'`.

---

## Corrective Task Handoff

Author a corrective Task Handoff when at least one finding is actioned and the budget is not exhausted.

### Filename

```
tasks/{NAME}-TASK-P{NN}-T{NN}-{TITLE}-C{N}.md
```

where `N = corrective_tasks.length + 1` at authoring time. Example: if `corrective_tasks` is empty (first mediation cycle), the file is `-C1.md`.

### Code-task RED-GREEN shape

For `code`-type corrective handoffs, the 4-step RED-GREEN shape is mandatory: (1) write the failing test; (2) run and confirm it fails; (3) implement minimal code; (4) run and confirm it passes. Mirrors the explosion-script `code`-task shape (`rad-create-plans/references/master-plan/workflow.md:132–140`). `doc`/`config`/`infra` correctives follow author-chosen step shapes; every step still ends in a requirement tag.

### Frontmatter

Same core shape as an original Task Handoff, plus four additional fields:

```yaml
---
project: "{NAME}"
phase: {NN}
task: {NN}
title: "{TITLE}"
status: "pending"
skills: [...]                  # same skills as the original handoff
estimated_files: {N}
corrective_index: 1            # 1-based; equals N above
corrective_scope: task
budget_max: 5                  # max_retries_per_task from orchestration.yml
budget_remaining: 4            # informational: budget_max - corrective_index
---
```

### Body

The corrective handoff body must be **self-contained**. A coder reading it should be able to execute the work without loading any prior review doc, prior handoff, or prior attempt's output.

Structure:

1. **Preamble** — one or two paragraphs describing the original task's intent: what function or feature is being built, which file(s) it lives in, and what the acceptance criteria are. Write this as if the coder has no knowledge of prior attempts.
2. **Corrective Steps** — the specific changes required to satisfy the actioned findings, written as concrete implementation instructions.

**Do not include:**

- References to prior review documents.
- References to prior corrective attempts.
- Delta reasoning ("the previous attempt did X but should have done Y").
- Any language that implies this is a correction — the coder writes fresh code against a self-contained spec.

### Bundling

One corrective handoff per mediation cycle. All actioned findings from a single mediation cycle land in a single handoff. Do not split findings across multiple handoffs.

---

## Signaling After Mediation

After authoring the addendum and (if applicable) the corrective handoff, signal the event to the pipeline:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" pipeline signal \
  --event code_review_completed \
  --project-dir <dir> \
  --doc-path <path-to-review-doc>
```

The pipeline reads the review doc's frontmatter — specifically `effective_outcome` and `corrective_handoff_path` — to determine whether to birth a corrective task entry or advance the pipeline normally.
