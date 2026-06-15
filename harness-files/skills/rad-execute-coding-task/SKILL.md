---
name: rad-execute-coding-task
description: 'Execute a single task end-to-end from a self-contained task-handoff document. Supports `code` (with mandatory RED-GREEN) and `doc` / `config` / `infra` task types, plus handoffs that declare no explicit task type. The handoff is the sole input; no upstream planning docs are read.'
user-invocable: false
---

# Execute Coding Task

Implement the task described in a self-contained task-handoff document. The handoff carries every contract, interface, file target, step, and acceptance criterion you need — nothing outside it is authoritative.

## Role & Constraints

**You read**: the task-handoff document at the path provided (`handoff_doc`) and the source files it references. That is all.

**DO NOT read upstream planning docs** — no requirements specs, master-plan / phase-plan files, product-spec / design / architecture artifacts, or any earlier pipeline output. The handoff is self-contained; anything you need is inlined verbatim. Reading upstream docs re-introduces the drift the pipeline explicitly eliminated.

**You write**: source code, tests, and (optionally) an `## Execution Notes` appendix appended to the END of the handoff body.

**Not yours**: `state.json` writes, git commits (owned by the source-control skill), any product / design / architectural decision not already inlined in the handoff.

## Uniform handoff contract

Original handoffs (emitted by the explosion script) and corrective handoffs (authored by the orchestrator from code-review mediation) share **one shape**. Read whichever `handoff_doc` the pipeline hands you — original or corrective — with the same workflow. No mode branching. No visibility into reviewer finding tiers (on-track / drift / regression / met / missing); the orchestrator pre-digests tier reasoning into the corrective handoff body, so you execute steps as written.

## Workflow

1. **Read the handoff** at `handoff_doc` end-to-end before touching code.
2. **Understand** the Intent, Requirements, File Targets, Steps, Acceptance, and any other section the handoff carries. Handoffs vary in section names — read what the document actually uses.
3. **Implement** step-by-step in the order written. Match inlined contracts exactly (signatures, return types, design tokens).
4. **Test** — run the test suite and record actual output. Do not assume results.
5. **Self-review** (see "Pre-report self-review" below) before emitting `task_completed`.
6. **Emit** source + tests + optional Execution Notes appendix.

## Task-type branching

Branch on task type **only** when the handoff declares one explicitly (a `task_type:` field in frontmatter, or a labeled section in the body). If no explicit task type is present, do not infer one from the file targets or step shape — execute the handoff as written.

- **Explicit `code`** — mandatory 4-step RED-GREEN: (1) write the failing test, (2) run and confirm it fails, (3) implement minimal code to pass, (4) run and confirm it passes. Mirrors the authoritative spec in `rad-create-plans/references/master-plan/workflow.md:132–140`.
- **Explicit `doc`** / **`config`** / **`infra`** — follow the handoff's author-chosen steps in order. No TDD shape required, but every step still traces to a requirement tag as written.
- **No explicit task type** — follow the handoff workflow and steps exactly as written. Do not apply a template.

## TDD red-flag self-checks (`code` tasks)

Any of these fired → log as an Execution Note:

- The first test run passed — RED-GREEN slipped; the test likely did not exercise the new behavior.
- Production code was written before the test — RED-GREEN inverted.
- You rationalized a "just this once" skip of a red-flag check — the rationalization itself is the flag.

## Test-quality anti-pattern gate

Hard rules on **your own** test and code additions:

- No test-only methods, branches, or accessors in production code.
- No mocks introduced without understanding — in writing — what real collaborator they replace and why.
- No assertions that verify only mock behavior (`expect(mock).toHaveBeenCalled()` with nothing about the production side effect).
- No meta tests that assert on test structure (e.g. "this test file has a test for each method in the implementation file") — tests should assert on production behavior, not test structure.

**Carve-out**: if a handoff step explicitly prescribes one of these shapes, follow the handoff but log the concern as an Execution Note so the authoring upstream (explosion script or orchestrator) gets feedback.

## Pre-report self-review

Before emitting `task_completed`, scan your own diff against four dimensions. Findings → Execution Notes.

- **Completeness** — every File Targets entry implemented; every step's expected output present.
- **Quality** — contracts match the inlined interfaces; no dead code; no stray scope.
- **Discipline** — YAGNI held (no speculative abstractions); File Targets respected (no out-of-scope edits).
- **Testing** — tests exercise production behavior, not mock behavior; RED-GREEN shape honored on `code` tasks.

## Execution Notes appendix

A single channel for executor feedback to the stateless code reviewer and the orchestrator — without halting the pipeline.

- **Where**: append to the END of the handoff doc body under a `## Execution Notes` heading. No earlier placement. No separate file.
- **When** to log: a step was ambiguous and required interpretation; a File Targets exception was made; a TDD red-flag fired; an anti-pattern shape was followed per handoff prescription; the pre-report self-review surfaced a gap.
- **What** to include: which step; what was ambiguous or required interpretation; what you actually did; the rationale.
- **Why**: the handoff becomes the single durable record of both intent (from upstream authoring) and execution (from you). The stateless reviewer sees Execution Notes naturally when reading the handoff for tag resolution — no review-workflow change needed.

## CWD hygiene

The spawn prompt carries a `repos[]` array. Each entry has a `name` and an absolute `path`. A single-repo task has a length-1 array — same rule, no special-casing.

For each repo in `repos[]`:

1. Match the repo's `name` against the `**Files for <repo>:**` section in the handoff to find that repo's file targets.
2. Run all terminal commands for that repo from `repos[N].path` (the repo's own absolute path).
3. After finishing that repo's commands, restore the working directory to the workspace root before moving to the next repo.

Workspace root is the directory you started in (or the path given in the spawn prompt as the workspace root). Never carry a stale subdirectory CWD between repos or between tool calls.

## Output contract

| Artifact | Path | Format |
|----------|------|--------|
| Source code | File Targets entries (Create / Modify) | Language-specific |
| Tests | Paths derived from the handoff's Steps / Acceptance (or whichever section specifies tests) | Language-specific |
| Execution Notes (optional) | Appended to end of `handoff_doc` under `## Execution Notes` | Markdown |

## Quality standards

- **Handoff is contract.** What it says, you implement — exactly, not approximately.
- **Test results and build status are actual.** Run them; record real output; never assume pass.
- **Deviations are logged, not hidden.** Anything that differs from the handoff's literal prescription goes in Execution Notes with rationale.
- **Scope is the File Targets list.** Edits outside it are an anti-pattern; decline and log.
