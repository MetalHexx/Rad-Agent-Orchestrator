---
project: "CODER-COMMIT-PIPE-E2E"
type: requirements
status: approved
created: "2026-07-01"
project-type: side-project
repos: ["CODER-COMMIT-PIPE-E2E"]
repo-group: null
requirement_count: 1
---

# CODER-COMMIT-PIPE-E2E — Requirements

A minimal side-project that exists only to give the pipeline-mode harness a single, real coding
task to execute and commit. The deliverable is a pure, dependency-free `slugify(str)` helper with
a unit test — small enough that the run is fast and deterministic, real enough that the coder must
actually write code, test it, and commit it on the task branch.

## Goals

- Provide one self-contained coding task the pipeline can explode into a single handoff.
- Ship a pure ESM `slugify(str)` that lowercases, trims, hyphenates, and strips edge separators.
- Cover the behavior with a `node:test` suite that runs under `node --test` with no dependencies.

## Non-Goals

- No CLI, no flags, no configuration, no I/O surface.
- No multiple phases or tasks — exactly one, so exactly one handoff is emitted.
- No remote repository — this is a side-project; the commit stays local (`pushed: false`).

## Affected Repositories

| Repository | Role | Nature of change |
|---|---|---|
| `CODER-COMMIT-PIPE-E2E` | The standalone side-project repo (no registered repo, no remote) | New: `src/slugify.js` plus its `node:test` suite. |

## Requirements

### R1: Pure `slugify(str)` with unit test

A single named ESM export that normalizes an arbitrary string into a URL-style slug, exercised by
a built-in-runner unit test.

- `slugify(str)` lowercases the input, trims it, collapses each run of non-`[a-z0-9]` characters
  into a single `-`, and strips leading/trailing `-`.
- Named export only; there is no default export.
- `slugify('Hello, World!')` returns `'hello-world'`; `slugify('  Foo   Bar  ')` returns `'foo-bar'`.
- **Technical:** the function is pure (no I/O, no dependencies) and lives in `src/slugify.js`; the
  test suite lives in `src/__tests__/slugify.test.js` and runs on Node's built-in `node:test` +
  `node:assert`, invoked via `node --test`, preserving a zero-runtime-dependency posture.

## Technical Specification

One source file plus one test. `src/slugify.js` exports the pure `slugify()` function; the test
asserts the two canonical examples, a leading/trailing-separator case, and the absence of a default
export. There is no entrypoint, manifest requirement, or build step beyond what `node --test` needs.

### Testing Approach

Unit level only. The pure `slugify()` function is the seam: one `node:test` file asserts the
documented input→output pairs and the no-default-export contract. No integration or e2e layer is
warranted for a single pure function.

## Key Files & Modules

- `CODER-COMMIT-PIPE-E2E`: `src/slugify.js` (the pure `slugify()` export) and
  `src/__tests__/slugify.test.js` (its `node:test` suite).
