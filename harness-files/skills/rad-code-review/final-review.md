# Final Review

You review the **cumulative project diff** against the Requirements doc — the whole thing, end to end. This is the last gate before a human approves the merge. It is **strict and terminal**: there is no corrective cycle at this scope, so your verdict stands as written.

## Inputs (from spawn context)

- `requirements_doc` — the project Requirements: everything the project owed. Your conformance contract. (`null` if the engine could not resolve it — say so in the report and ask for help.)
- `phase_plan_paths` — the list of phase plans, as an **orientation map**: use them to understand how the work was decomposed and where each requirement was meant to land. They are context for navigating the diff, not a second contract to audit.
- `repos[]`, `project_base_sha`, `project_head_sha` — the whole-project commit range (`null` when auto-commit is off).

Read only these. The Requirements doc is your contract and the phase plans are an orientation map — do **not** open the Master Plan, the per-task handoffs, or the task/phase **review reports**. Those are upstream and sibling artifacts, not final-scope inputs; you judge the working tree and the diff against the requirements, not against what earlier reviews said.

## Do

1. **Read the Requirements doc** in full — enumerate what the project owed. At final scope there is no partial credit: each requirement is **delivered** or **missing**.
2. **Skim the phase plans** (`phase_plan_paths`) to orient — which phase carried which requirement, so you know where in the diff to look. Don't audit them; they are a map.
3. **Run the cumulative project diff, read-only.** With both SHAs: `git diff <project_base_sha>~1..<project_head_sha>` (+ `--stat`). If either is `null`: `git diff HEAD` (+ `--stat`) and read untracked files.
4. **Run the full test suite and build yourself** — capture the real command and named output. Final review earns the right to be exhaustive here; do not scope-limit.
5. **Two lenses at project scale** (SKILL.md → the two lenses):
   - *Conformance (strict)* — is every requirement actually delivered in the working tree? A requirement with no delivering evidence is a **missing**-requirement finding (medium severity at minimum).
   - *Quality* — cross-phase integration and whole-project soundness against the coder's engineer charter: contract drift across phase boundaries, project-wide dead-on-arrival exports, architectural integrity. Cite `file:line`.
6. **Verdict** from the highest-severity finding (SKILL.md → verdict). A missing requirement is `changes_requested` at minimum; reserve `rejected` for damage or defects that are severe and need human intervention.

## Report

Write to `{PROJECT-DIR}/reports/{NAME}-FINAL-REVIEW.md`. Use the report shape in SKILL.md, with these final-scope differences:
- Frontmatter carries only `project`, `verdict`, `severity`, `author`, `created` — no `phase`/`task`, no `exit_criteria_met`.
- The `## Findings` list distinguishes missing-requirement findings (conformance) from quality findings; both share one number sequence.
