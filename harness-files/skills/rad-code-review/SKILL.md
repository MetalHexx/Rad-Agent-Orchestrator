---
name: rad-code-review
description: 'Review code, phases, and projects for quality, correctness, and conformance. Supports three modes: task review, phase review, and final review. Each mode runs a conformance-first pass against a per-requirement audit table, followed by a lean quality sweep. Status semantics are scope-aware — task and phase use tiered status (on-track / drift / regression); final uses strict status (met / missing).'
user-invocable: false
---

# Code Review

Three modes. Identify yours from the spawn context fields you received, then follow the matching workflow file end-to-end. Each mode's workflow is fully self-contained — do not load any other review doc or cross-reference between modes.

Each mode emits **one combined review document** per scope, regardless of how many repos the task, phase, or project touches. The `## Scope` section contains one sub-block per repo; the `## Repo Boundary Check` section judges repo-level containment across all repos. Per-requirement audit rows are not attributed to individual repos — a requirement is evaluated holistically across all repos' diffs.

| Your context includes…                                       | Mode  | Scope                                                          | Status Enum                     | Workflow                                               | Template                                               |
|--------------------------------------------------------------|-------|----------------------------------------------------------------|---------------------------------|--------------------------------------------------------|--------------------------------------------------------|
| `task_number` (and `task_id`, `repos[]` each with `head_sha`) | Task  | Each repo's diff vs. its Task Handoff contract slice           | `on-track \| drift \| regression` | [task-review/workflow.md](./task-review/workflow.md)   | [task-review/template.md](./task-review/template.md)   |
| `phase_first_sha` (and `phase_head_sha`, `repos[]`)          | Phase | Each repo's cumulative diff vs. its Phase Plan contract slice  | `on-track \| drift \| regression` | [phase-review/workflow.md](./phase-review/workflow.md) | [phase-review/template.md](./phase-review/template.md) |
| `project_base_sha` (and `project_head_sha`, `repos[]`); no task / phase | Final | Each repo's cumulative diff; requirements judged holistically across all repos | `met \| missing` | [final-review/workflow.md](./final-review/workflow.md) | [final-review/template.md](./final-review/template.md) |

Every mode writes a per-requirement audit table. Verdict enum is unchanged across all three: `approved | changes_requested | rejected`. Each workflow runs the conformance pass first, then a lean quality sweep; findings merge and highest severity wins.

## Evidence-Not-Intent Charter

These rules apply to **every** review mode. Violations invalidate the review.

1. **The diff is truth. The handoff is intent. Execution notes are not evidence.** If a sentence in your review would read identically whether you had run the diff or not, delete it.
2. **No copy-paste from the Task Handoff, Phase Plan, or prior reviews.** Summaries of prescribed content are not review output. If the handoff prescribes file content verbatim, your conformance claim must show the comparison mechanism (diff command, byte-range reference), not restate the prescription.
3. **Every finding carries evidence.** Evidence is one of: a quoted code line with `File:Line`, a diff excerpt, captured test output, or a grep result. An audit row with `status=on-track` still requires evidence (the proof that the slice is correct).
4. **Positive observations never cushion deferred or silent behavior.** If the code silently does nothing where a requirement is deferred to a later task, that is a carry-forward note or quality finding — not a positive.
5. **Verdicts cite the driving finding.** An `approved` verdict cites "no findings ≥ low severity, all audit rows on-track". A `changes_requested` verdict names the finding ID(s) that drove it.
6. **Ran it yourself.** Test counts, build status, and diff stats come from commands you executed in this review session, not from any upstream report.

## Finding-ID Scheme

Every finding in every finding-bearing table gets a stable `F-N` identifier, numbered sequentially per review doc starting at `F-1`. Conformance-pass findings (drift / regression rows in the audit table) and quality-sweep findings share the same `F-N` space. IDs reset per review document — a corrective review starts fresh at `F-1`. The orchestrator's corrective-playbook addendum keys its disposition table off these IDs; missing or duplicate IDs break the mediation contract.

## Evidence Contract

Every row in every finding-bearing table (per-requirement audit, quality sweep) carries these fields:

- **`F-ID`** — stable finding identifier (see Finding-ID Scheme).
- **`File:Line`** — concrete source pointer (e.g., `src/cli.js:42` or `src/cli.js:42-58`). Use `—` only when the finding genuinely spans no specific location (rare; most NFRs still have representative sites).
- **`Evidence`** — quoted code, diff excerpt, test output, or grep result that establishes the finding. Paraphrase is not evidence. Use `—` only for on-track rows where the evidence is the absence of drift across the entire listed file range; cite the range in `File:Line` in that case.

The per-mode templates enforce these columns. A review doc that lacks `F-ID`, `File:Line`, or `Evidence` in any finding row is structurally invalid.
