---
project: "CODER-COMMIT-PIPE-E2E"
type: master_plan
status: draft
created: "2026-07-01"
project-type: side-project
repos: ["CODER-COMMIT-PIPE-E2E"]
repo-group: null
total_phases: 1
total_tasks: 1
---

# CODER-COMMIT-PIPE-E2E — Master Plan

## Introduction

A single-task side-project whose only purpose is to drive the real pipeline through the
execution/commit tier. The one task adds a pure ESM `slugify(str)` to the project's local
repo; the coder implements it, tests it under `node --test`, and — because the pipeline
seals `should_commit: true` for this side-project — commits its own work on `main`. There is
no remote, so the push is skipped and `pushed: false`.

## Execution Map

**P01 · Foundation** · repos: CODER-COMMIT-PIPE-E2E · order: T01

| Task | Repo | Complexity | Purpose |
|---|---|---|---|
| T01 | CODER-COMMIT-PIPE-E2E | simple | Add a pure ESM `slugify(str)` and its unit test. |

## P01: Foundation

Once this phase completes the repo contains a tested, dependency-free `slugify()` helper,
committed on `main` by the coder itself — the single unit of work the pipeline-mode harness
needs to exercise the coder's fold-in commit contract end to end.

### P01-T01: Slugify

Add a pure ESM `slugify(str)` to the CODER-COMMIT-PIPE-E2E repo. Self-contained; implement to
the repo's conventions, test what matters, and commit as directed.

**Task type:** code
**Complexity:** simple
**Target repo:** CODER-COMMIT-PIPE-E2E

**Files for CODER-COMMIT-PIPE-E2E:**
- Create: `src/slugify.js` (the pure `slugify()` ESM module).
- Create: `src/__tests__/slugify.test.js` (a `node:test` suite for it).

**The change**
- Add a named ESM export `slugify(str)` to `src/slugify.js`:
  ```ts
  export function slugify(str: string): string
  ```
- It lowercases, trims, collapses each run of non-`[a-z0-9]` characters into a single `-`,
  and strips leading/trailing `-`. Named export only — **no default export**.
- Pure function: no I/O, no dependencies, Node built-ins only.

**Done when**
- `slugify('Hello, World!')` returns `'hello-world'`.
- `slugify('  Foo   Bar  ')` returns `'foo-bar'`.
- Named ESM export; no default export.
- The suite passes under `node --test`.

**Testing**
- Cover both `Done when` examples plus a leading/trailing-separator case and an assertion
  that there is no default export.
- Run `node --test src/__tests__/slugify.test.js` from the repo root; record the actual output.
- Skip brittle assertions on internal regex shape — assert observable output only.
