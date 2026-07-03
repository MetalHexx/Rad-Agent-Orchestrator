---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 3
title: Write usage README with showcase
status: pending
complexity: simple
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T02:40:09.823Z'
type: task_handoff
---

# P01-T03: Write usage README with showcase

Document the CLI so a newcomer goes from clone to banner in seconds: how to run it, the
supported Node version, and a static snapshot of the output so the result is visible without
running anything.

**Task type:** doc
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `README.md` (usage + showcase).

**The change**
- Cover, concisely: installation (clone; no `npm install` step is needed since there are zero
  runtime dependencies), how to run (`node index.js` or `npm start`), the supported Node
  version (18+, matching `engines`), and how to run the test (`npm test`).
- Include a static **showcase** of the banner — a fenced code block snapshot of the
  "HELLO WORLD" ASCII art — with a one-line note that the letters render in rainbow color on an
  ANSI-capable terminal (since the escape codes don't survive a plain Markdown block).

**Done when**
- README documents install, the run command, the supported Node version, and the test command.
- README includes a static banner showcase block so the output is visible without running the
  CLI.

**Testing**
- Doc task — no automated test. Don't add a test that asserts README prose or the showcase
  text; static-content assertions are brittle by nature.

## Execution Notes

_(none yet — appended at runtime)_
