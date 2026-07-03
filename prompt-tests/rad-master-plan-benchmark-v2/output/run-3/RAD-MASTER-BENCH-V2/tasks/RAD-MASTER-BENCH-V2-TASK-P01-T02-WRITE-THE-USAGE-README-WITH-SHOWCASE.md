---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 2
title: Write the usage README with showcase
status: pending
complexity: simple
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:21:00.745Z'
type: task_handoff
---

# P01-T02: Write the usage README with showcase

Write the project README so a newcomer goes from clone to banner in seconds: install/run steps,
the supported Node version, and a static showcase of the output so the result is visible without
running it. Covers R6. Depends on T01 having settled the run commands and the banner shape.

**Task type:** doc
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `README.md` (usage + showcase).

**The change**
- Document, in order: what the CLI is (one line), how to run it (`node index.js` **or**
  `npm start`), how to run the test (`npm test`), and the supported Node baseline (18+, matching
  `package.json` `engines`).
- Include a **static showcase** of the banner — a fenced code block holding the rendered
  "HELLO WORLD" ASCII-art so the output is visible on the page without running the CLI. (Show the
  glyph shapes as plain text; raw ANSI escapes don't render in Markdown, so describe that the live
  output is rainbow-colored rather than pasting escape codes.)
- Keep run commands and the Node version consistent with the `package.json` scripts/`engines`
  produced in T01 — this is the cross-task seam: the README must match the actual `start`/`test`
  scripts and engine baseline, not invent its own.

**Done when**
- README documents install, run (`node index.js` / `npm start`), test (`npm test`), and the
  Node 18+ requirement.
- README contains a static ASCII-art showcase block of the banner output.
- Run commands and Node version in the README match `package.json` exactly.

**Testing**
- No automated test — this is a doc task; correctness is that the commands and Node version match
  `package.json` and the showcase reflects the real banner shape.
- Skip any test that asserts the README's exact prose (brittle content-assertion).

## Execution Notes

_(none yet — appended at runtime)_
