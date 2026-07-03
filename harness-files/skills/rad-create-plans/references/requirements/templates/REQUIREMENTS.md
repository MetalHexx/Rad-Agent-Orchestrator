---
project: "{PROJECT-NAME}"
type: requirements
status: draft
created: "{YYYY-MM-DD}"
project-type: standard
repos: [repo-a, repo-b]
repo-group: repo-group-name
---

# {PROJECT-NAME} — Requirements

{Lean preamble — 2–4 sentences: the problem being solved and the intent. State
what this is and why it exists; don't restate the Goals below.}

## Goals

- {Single-line, high-signal goal.}
- {…}

## Non-Goals

- {What is deliberately out of scope.}

## Companion Documents

{Only when supplemental artifacts exist. Link each by relative path — visual
(wireframes, diagrams, HTML summaries) and non-visual (PRD, data model, API
contract). Keep in lockstep with this document.}

- [{title}](./{NAME}-{ARTIFACT}.html)

## Affected Repositories

| Repository | Role | Nature of change |
|---|---|---|
| `{repo}` | {what it does here} | {new / edited surfaces} |

## Requirements

### R1: {Thing to build}

{One-line lead — what this is.}

- {Functional behavior — high-signal bullets.}
- {Design / UX detail, if any.}
- {Technical detail specific to this requirement — contracts, fields, edge cases.}

### R2: {Thing to build}

{…}

## Technical Specification

{Cross-cutting structure, stated once: architecture, contracts, data model,
quality attributes, risks. Tables for models/contracts/field sets; a mermaid
diagram where a picture beats prose.}

### Security Considerations

{Only when the work has a security surface. Trust boundaries, authn/authz, input
validation, secrets — name the threats that apply and their mitigations, not a
generic checklist.}

## UI/UX Design

{Only when the work has a UI/UX surface. Design tokens, shared components to
create / update / reuse, layout patterns, accessibility/a11y, and other UI/UX concerns.}

### Testing Approach

{The test levels that apply (unit, integration, e2e), what must be covered, and
any fixtures or seams the Master Plan should account for. Intent, not a
test-by-test script.}

## Required Skills and MCPs

{Tooling surfaced during authoring, captured for a later Master Plan session.
Omit when none.}

- **Repo skills:** {skill — repo tag}, or "none surfaced".
- **MCPs:** {connected servers worth reaching for}, or "none required".

## Key Files & Modules

{The surface the Master Plan will touch — a map, not an implementation plan.}

- `{repo}`: {modules / files}.

## Open Questions

{Only when something is genuinely unresolved. The open decisions and what each
blocks — ask the user rather than assume. Resolve these before `/rad-plan` builds
the Master Plan.}

- {The open question — and what it blocks.}
