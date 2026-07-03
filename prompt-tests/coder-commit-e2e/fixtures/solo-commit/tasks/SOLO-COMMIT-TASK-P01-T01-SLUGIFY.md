---
project: SOLO-COMMIT
phase: 1
task: 1
title: "Slugify"
status: pending
complexity: simple
repos: [solo-commit]
created: 2026-07-01T00:00:00.000Z
type: task_handoff
---

# P01-T01: Slugify

Add a pure ESM `slugify(str)` to the `solo-commit` repo. This handoff is self-contained —
implement to the repo's conventions, test what matters, and commit your work as directed.

**Task type:** code
**Complexity:** simple
**Target repo:** solo-commit

**Files for solo-commit:**
- Create: `src/slugify.js`
- Create: `src/__tests__/slugify.test.js`

**The change**
Add a named ESM export `slugify(str)` to `src/slugify.js` that lowercases the input, trims it,
collapses each run of non-`[a-z0-9]` characters into a single `-`, and strips leading/trailing
`-`. Named export only — no default export, no CommonJS. Cover it with a `node:test` +
`node:assert` suite in `src/__tests__/slugify.test.js`.

**Done when**
- `slugify('Hello, World!')` returns `'hello-world'`.
- `slugify('  Foo   Bar  ')` returns `'foo-bar'`.
- Named ESM export; no default export.
- The suite passes under `node --test`.

**Testing**
Run `node --test src/__tests__/slugify.test.js` from the repo root; record actual output.

## Execution Notes

_(none yet — appended at runtime)_
