---
project: RAD-MASTER-BENCH-V2
phase: 2
task: 1
title: Author the usage README with output showcase
status: pending
complexity: simple
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:45:17.207Z'
type: task_handoff
---

# P02-T01: Author the usage README with output showcase

Write the project README so the finished command is self-explanatory: how to install and
run it, what Node version it needs, and a static showcase of the banner so a reader sees
the result before running anything.

**Task type:** doc
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `README.md` (usage instructions + a static showcase of the banner output).

**The change**
- Document installation (clone, no `npm install` step needed since there are no runtime
  dependencies), how to run the CLI (`node index.js` and the `npm start` equivalent), and
  the supported Node version (18+, matching the manifest `engines`).
- Include a static showcase of the banner: a fenced code block containing the ASCII-art
  "HELLO WORLD" so the shape and layout are visible in the README even though terminal
  colors don't render in Markdown. Note in a line of prose that the live output is
  rainbow-colored per letter.
- Keep it short and scannable — a newcomer should reach a rendered banner in seconds.

**Done when**
- `README.md` covers installation, the run command(s), and the Node 18+ requirement.
- It contains a fenced code block showing the ASCII-art banner as a static showcase.
- The documented run commands match the actual `start` script and entrypoint.

**Testing**
- No automated test — this is documentation. Verify by reading: the commands shown match
  `package.json`/`index.js`, and the showcased banner matches the real output shape.
- Skip any test that asserts on the README's prose or exact bytes; static-content
  assertions are brittle by nature.

## Execution Notes

_(none yet — appended at runtime)_
