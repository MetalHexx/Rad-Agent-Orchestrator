---
portfolio: "{PORTFOLIO}"
doc: GROUND-TRUTH
description: "What is verifiably true about the system today, with citations — verified fact and nothing else. Read before investigating anything."
created: "{DATE}"
updated: "{DATE}"
---

> **Template guidance — delete this block when instantiating.**
>
> This document exists to stop the same investigation being run four times.

# {PORTFOLIO} — Ground Truth

> **What this holds.** What is actually true about the system as it stands, each claim traced to
> where it was verified. **Verified fact and nothing else.**
>
> **It is not** the design — [Technical](./{PORTFOLIO}-TECHNICAL.md) is what we intend, this is
> what *is*. See *What does not go here* for the rest.

## What does not go here

> - **Absences as absences.** "There is no rename command" is unfalsifiable; "`project --help`
>   exposes list, show, locate, worktrees, delete" says the same thing and is checkable.
> - **Rejected ideas.** Something considered and chosen against is a decision — it belongs in
>   that decision's own entry, as the alternative it beat.
> - **Unverified beliefs.** They live in the decisions document's `## Assumptions` zone until
>   something discharges them.

---

## Verified

> Claims confirmed by looking. Each cites a path, command, or observation concrete enough to
> re-run in one step. Group by area as this grows — a flat table stops being readable somewhere
> around thirty rows.

### {Area}

| What is true | Where | Verified | Against |
|---|---|---|---|
| {The claim, stated flatly} | `{path/to/file.ts:42}` or `{the command}` | {DATE} | {commit, version, or "current main"} |

---

## Staleness

> Facts rot, and the dates above are what makes rot visible. There is no blanket expiry — this
> section names the **trigger** for the rows that will not stay true.

| Fact | Re-verify when |
|---|---|
| {The claim} | {The concrete event that would invalidate it — a version bump, a refactor landing, an upstream release} |
