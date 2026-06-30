---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 3
title: Write the usage README with a static showcase
status: pending
complexity: simple
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:36:53.924Z'
type: task_handoff
---

# P01-T03: Write the usage README with a static showcase

The front door: a README that takes a newcomer from clone to banner in seconds and shows the
result without making them run it. When it lands, the project documents how to install and run,
states the supported Node version, and shows what the output looks like.

**Task type:** doc
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `README.md` (installation, how to run, supported Node version, and a static showcase of
  the banner output).

**The change**
- Document, concisely: cloning/installing, running via both `node index.js` and `npm start`,
  running the test via `npm test`, and the supported Node baseline (18+, matching `engines.node`).
- Include a static **showcase** of the banner so the result is visible without running it — a
  fenced code block of the ASCII-art "HELLO WORLD" (a plain-text approximation of the blocky art
  is fine; the live terminal output is colored). Note that colors render on ANSI-capable terminals.
- Keep it short and skimmable — this is a one-sprint side project, not a manual. State that there
  are no flags or configuration (run-once by design), consistent with the Non-Goals.

**Done when**
- `README.md` covers install, run (`node index.js` / `npm start`), test (`npm test`), and the
  Node 18+ requirement.
- It contains a static showcase block of the banner output and notes that coloring requires an
  ANSI-capable terminal.

**Testing**
- None — this is a documentation deliverable. Do not add a test that asserts the README's prose or
  the showcase text; such content-assertion tests are brittle and protect nothing. A human read
  for accuracy is the check.

## Execution Notes

_(none yet — appended at runtime)_
