---
portfolio: "{PORTFOLIO}"
doc: TECHNICAL
description: "The intended architecture at portfolio altitude, organized by concern — how each part is meant to work."
created: "{DATE}"
updated: "{DATE}"
---

> **Template guidance — delete this block when instantiating.**
>
> The seeded concerns below are a starting spread, not a required set. Add and remove freely.

# {PORTFOLIO} — Technical

> **What this holds.** The architecture of {PORTFOLIO} at portfolio altitude, one section per
> concern — what each part is meant to be, in present tense, whether or not it is built yet.
>
> **It is not** the reasoning behind the shape (that's [Decisions](./{PORTFOLIO}-DECISIONS.md)),
> what the code does today (that's [Ground Truth](./{PORTFOLIO}-GROUND-TRUTH.md)), or a schedule
> (that's [Iterations](./{PORTFOLIO}-ITERATIONS.md)). Present tense here is intended shape, never
> a claim the shape has shipped — keeping intent, fact, and time apart is what stops a design
> document quietly becoming wrong.

---

## Shape

> The whole system in one pass. Someone who reads only this section should be able to hold the
> system in their head.

{The overview.}

---

## {Concern}

> One `##` per concern. Everything under it is yours — sub-headings, tables, diagrams.

{The intended design for this concern: what it is responsible for, what it does not own, and
where it meets the concerns next to it.}

**Boundaries.** {What this concern deliberately does not do, and who does it instead.}

**Open at this altitude.** {Anything unresolved *about the shape* — link the question in
[Decisions](./{PORTFOLIO}-DECISIONS.md#open) rather than restating it.}

---

<!-- Seeded concerns for a coding portfolio. Keep what applies, delete the rest, add your own. -->

## Data and Storage

{What is persisted, where it lives, who owns writes to it, and what shape it takes.}

## Contracts and Interfaces

{The seams between parts — what each side may assume, and what stays stable across changes.}

## CLI Surface

{The commands, their nouns and verbs, and what an agent versus a human reaches for.}

## Dashboard and UI

{What is rendered, where the data comes from, and what the interface owns versus displays.}

## Agent and Skill Surface

{Which skills exist, what each owns, and how an agent moves between them.}

## Integration Points

{Everything outside this system that it touches — and what happens when that thing is absent,
slow, or wrong.}

---

## Cross-Cutting

> Concerns that are not a layer but run through every layer, and that each iteration has to
> keep true. Most easily lost between iterations, which is why they get their own section.

- **{Thread}** — {what it requires of every part of the system}
