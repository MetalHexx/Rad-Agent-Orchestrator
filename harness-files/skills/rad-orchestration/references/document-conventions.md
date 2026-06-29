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
| Corrective Task Handoff (task scope) | tasks/ | `{NAME}-TASK-P{NN}-T{NN}-{TITLE}-C{N}.md` | `MYAPP-TASK-P01-T02-AUTH-C1.md` |
| Corrective Task Handoff (phase scope) | tasks/ | `{NAME}-TASK-P{NN}-PHASE-C{N}.md` | `MYAPP-TASK-P01-PHASE-C1.md` |
| Code Review | reports/ | `{NAME}-CODE-REVIEW-P{NN}-T{NN}-{TITLE}.md` | `MYAPP-CODE-REVIEW-P01-T02-AUTH.md` |
| Phase Review | reports/ | `{NAME}-PHASE-REVIEW-P{NN}-{TITLE}.md` | `MYAPP-PHASE-REVIEW-P01-SETUP.md` |
| Final Review | reports/ | `{NAME}-FINAL-REVIEW.md` | `MYAPP-FINAL-REVIEW.md` |

### Corrective Filename Suffix

When a producing skill re-authors a document during a corrective cycle, append the suffix `-C{corrective_index}` immediately before `.md`. Read `corrective_index` from the event context — do not query the filesystem. The original (non-corrective) document is preserved, not overwritten.

- Normal (first-time): `{NAME}-PHASE-{NN}-{TITLE}.md`
- Corrective: `{NAME}-PHASE-{NN}-{TITLE}-C{corrective_index}.md`

| Scenario | Filename |
|----------|----------|
| Original plan | `MYPROJ-PHASE-02-SETUP.md` |
| First correction | `MYPROJ-PHASE-02-SETUP-C1.md` |
| Second correction | `MYPROJ-PHASE-02-SETUP-C2.md` |
| Original task handoff | `MYPROJ-TASK-P01-T02-AUTH.md` |
| Corrective task handoff (task scope, first) | `MYPROJ-TASK-P01-T02-AUTH-C1.md` |
| Corrective task handoff (phase scope, first) | `MYPROJ-TASK-P01-PHASE-C1.md` |
| Code review of a phase-scope corrective (first) | `MYPROJ-CODE-REVIEW-P01-PHASE-C1.md` |

The `-C{N}` suffix rule applies to Task Handoffs and task-level Code Reviews. It does NOT apply to Phase Reviews — under Iter 11's single-pass clause, a phase iteration runs `phase_review` exactly once; its corrective cycle is carried entirely by task-level re-reviews of the phase-sentinel Task Handoff (see "Phase-scope sentinel form" below). For Task Handoffs, the corrective handoff is authored by the orchestrator during mediation — not by a coder or planner. Each producing skill's workflow cross-references this section for the shared pattern.

**Phase-scope sentinel form.** When the orchestrator mediates a `phase_review` and the effective outcome is `changes_requested`, the authored corrective Task Handoff substitutes the `PHASE` token for the `T{NN}-{TITLE}` segment: `{NAME}-TASK-P{NN}-PHASE-C{N}.md`. The token signals that the corrective applies to phase-scope exit-criteria or cross-task integration — not a single task. The same sentinel carries through to the corresponding task-level code review filename: `{NAME}-CODE-REVIEW-P{NN}-PHASE-C{N}.md`. The corresponding state entry lives under `phaseIter.corrective_tasks[]`, not `taskIter.corrective_tasks[]`.

## Frontmatter Field Reference

| Field | Type | Valid Values | Used In |
|---|---|---|---|
| project | string | Project name in SCREAMING-CASE (e.g., `"MYAPP"`) | All templates |
| type | string | `"requirements"` \| `"master_plan"` (additional document-type marker on new docs) | Requirements, Master Plan |
| phase | integer | Phase number, 1-based (e.g., `1`) | Phase Plan, Task Handoff, Code Review, Phase Review |
| task | integer | Task number, 1-based (e.g., `2`) | Task Handoff, Code Review |
| title | string | Human-readable title (e.g., `"Setup Auth"`) | Task Handoff, Phase Plan |
| status | string | Varies by document — see below | Task Handoff, Phase Plan, Requirements, Master Plan |
| skills | array | Skill folder names from `${SKILLS_ROOT}/` | Task Handoff |
| estimated_files | integer | Estimated file count (e.g., `3`) | Task Handoff |
| tasks | array | List of `{id, title}` objects | Phase Plan |
| author | string | Agent or script name (e.g., `"planner-agent"`, `"explosion-script"`) | Phase Plan, Phase Review, Code Review, Master Plan |
| created | string | ISO 8601 date-time (e.g., `"2026-01-15T00:00:00.000Z"`) or ISO 8601 date (e.g., `"2026-01-15"`) | Phase Plan, Phase Review, Code Review, Requirements, Master Plan |
| total_phases | integer | Count of `## PNN:` phase headings in the Master Plan body | Master Plan |
| total_tasks | integer | Count of `### PNN-TMM:` task headings in the Master Plan body | Master Plan |
| verdict | string | `"approved"` \| `"changes_requested"` \| `"rejected"` | Code Review, Phase Review, Final Review |
| severity | string | `"none"` \| `"low"` \| `"medium"` \| `"high"` | Code Review, Phase Review |
| exit_criteria_met | boolean | `true` \| `false` | Phase Review |
| orchestrator_mediated | boolean | `true` (only value that appears) | Code Review, Phase Review |
| effective_outcome | string | `"approved"` \| `"changes_requested"` | Code Review, Phase Review |
| corrective_handoff_path | string | Path to corrective Task Handoff (present only when `effective_outcome === "changes_requested"`) | Code Review, Phase Review |
| corrective_index | integer | 1-based corrective attempt index (e.g., `1`) | Corrective Task Handoff |
| corrective_scope | string | `"task"` \| `"phase"` | Corrective Task Handoff |
| budget_max | integer | Value of `max_retries_per_task` at authoring time | Corrective Task Handoff |
| budget_remaining | integer | Informational remaining retry budget at authoring time | Corrective Task Handoff |

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