# Document Conventions

Canonical reference for all pipeline-produced document naming, placement, and frontmatter values.

Covers all documents produced during pipeline execution. Planning documents (Master Plan, Requirements) and execution documents (Phase Plan, Task Handoff, Code Review, Phase Review). Also covers the action / event catalog files that drive the composer at envelope-build time.

## Filename Patterns & Placement

| Document Type | Subdirectory | Filename Pattern | Example |
|---|---|---|---|
| Master Plan | — (root) | `{NAME}-MASTER-PLAN.md` | `MYAPP-MASTER-PLAN.md` |
| Requirements | — (root) | `{NAME}-REQUIREMENTS.md` | `MYAPP-REQUIREMENTS.md` |
| Error Log | — (root) | `{NAME}-ERROR-LOG.md` | `MYAPP-ERROR-LOG.md` |
| Phase Plan | phases/ | `{NAME}-PHASE-{NN}-{TITLE}.md` | `MYAPP-PHASE-01-SETUP.md` |
| Task Handoff | tasks/ | `{NAME}-TASK-P{NN}-T{NN}-{TITLE}.md` | `MYAPP-TASK-P01-T02-AUTH.md` |
| Code Review | reports/ | `{NAME}-CODE-REVIEW-P{NN}-T{NN}-{TITLE}.md` | `MYAPP-CODE-REVIEW-P01-T02-AUTH.md` |
| Phase Review | reports/ | `{NAME}-PHASE-REVIEW-P{NN}-{TITLE}.md` | `MYAPP-PHASE-REVIEW-P01-SETUP.md` |
| Final Review | reports/ | `{NAME}-FINAL-REVIEW.md` | `MYAPP-FINAL-REVIEW.md` |

### Review Report Path (`review_report_path`)

**One running report per scope instance.** Code Review, Phase Review, and Final Review documents are **stable, single files per scope**. The reviewer creates the file once; on a `changes_requested` verdict, the same path (carried as `review_report_path` in the pipeline's event context) is reopened by the coder to write dispositions, and by the next reviewer to re-adjudicate them. `corrective_index` (see Frontmatter Field Reference) tracks which adjudication cycle the file is currently on.

- Task scope: the task code review report — `{NAME}-CODE-REVIEW-P{NN}-T{NN}-{TITLE}.md`.
- Phase scope: the phase review report — `{NAME}-PHASE-REVIEW-P{NN}-{TITLE}.md`. A phase-scope corrective is carried by a task-level code review of the phase's sentinel task (`task_id: "P{NN}-PHASE"`), hosted under the phase iteration's `corrective_tasks[]`; the engine seeds that corrective with the phase review report as the running report, so the child reviewer is handed an existing report on its first spawn and takes the re-open-in-place branch — it never creates a new `CODE-REVIEW` document.
- Final scope: the final review report — `{NAME}-FINAL-REVIEW.md`, re-opened in place across adjudication cycles. It is **not** a new code-review document, even though the corrective's child node is a code review.

Task Handoffs are never re-authored for a review-stage corrective. The same handoff a task started with is reused, unchanged, across all of that task's corrective cycles — the coder reads it alongside the current `review_report_path`.

## Frontmatter Field Reference

| Field | Type | Valid Values | Used In |
|---|---|---|---|
| project | string | Project name in SCREAMING-CASE (e.g., `"MYAPP"`) | All templates |
| type | string | `"requirements"` \| `"master_plan"` (additional document-type marker on new docs) | Requirements, Master Plan |
| phase | integer | Phase number, 1-based (e.g., `1`) | Phase Plan, Task Handoff, Code Review, Phase Review |
| task | integer | Task number, 1-based (e.g., `2`) | Task Handoff, Code Review |
| title | string | Human-readable title (e.g., `"Setup Auth"`) | Task Handoff, Phase Plan |
| status | string | Varies by document — see below | Task Handoff, Phase Plan, Requirements, Master Plan |
| complexity | string | `"simple"` \| `"standard"` \| `"complex"` | Task Handoff |
| skills | array | Skill folder names from `${SKILLS_ROOT}/` | Task Handoff |
| estimated_files | integer | Estimated file count (e.g., `3`) | Task Handoff |
| tasks | array | List of `{id, title}` objects | Phase Plan |
| author | string | Agent or script name (e.g., `"code-review-agent"`) | Phase Review, Code Review |
| created | string | ISO 8601 date-time (e.g., `"2026-01-15T00:00:00.000Z"`) or ISO 8601 date (e.g., `"2026-01-15"`) | Phase Plan, Phase Review, Code Review, Requirements, Master Plan |
| total_phases | integer | Count of `## PNN:` phase headings in the Master Plan body | Master Plan |
| total_tasks | integer | Count of `### PNN-TMM:` task headings in the Master Plan body | Master Plan |
| verdict | string | `"approved"` \| `"changes_requested"` \| `"rejected"` | Code Review, Phase Review, Final Review |
| severity | string | `"none"` \| `"low"` \| `"medium"` \| `"high"` | Code Review, Phase Review |
| exit_criteria_met | boolean | `true` \| `false` | Phase Review |
| corrective_index | integer | 1-based corrective attempt/adjudication-cycle index (e.g., `1`) | Code Review, Phase Review, Final Review |
| corrective_scope | string | `"task"` \| `"phase"` \| `"final"` | Code Review, Phase Review, Final Review |

**`status` field values by document type:**

- Task Handoff: `"pending"`
- Phase Plan: `"active"` | `"complete"` | `"halted"`
- Requirements: `"draft"` | `"approved"`
- Master Plan: `"draft"` | `"approved"`

## Placeholder Token Convention

- All multi-word placeholders use `{SCREAMING-KEBAB-CASE}` (e.g., `{PHASE-NUMBER}`, `{TASK-NUMBER}`, `{TASK-TITLE}`, `{PROJECT-NAME}`)
- Single-word placeholders use `{SCREAMING-CASE}` (e.g., `{NAME}`, `{TITLE}`, `{NUMBER}`)
- Zero-padded numbers use `{NN}` only inside filename patterns (shorthand for a two-digit number); in frontmatter fields, use the explicit name (e.g., `{PHASE-NUMBER}`)
- The `{TASK-ID}` compound token (e.g., `T01-AUTH`) is a named exception — it is a composite of task number and title slug, not a general placeholder
- `{ISO-DATE}` means ISO 8601 date-time string (e.g., `2026-03-22T00:00:00.000Z`)