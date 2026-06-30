---
project: RAD-MASTER-BENCH-V2
phase: 1
title: Rainbow Hello-World CLI
status: active
tasks:
  - id: T01
    title: Build the pure rainbow renderer and its unit test
  - id: T02
    title: Wire the run-once CLI entrypoint and zero-dependency manifest
  - id: T03
    title: Write the usage README with a static showcase
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:36:53.924Z'
type: phase_plan
---

# Phase 1: Rainbow Hello-World CLI

When this phase completes the project is shippable end-to-end: `npm start` (or `node index.js`)
prints the rainbow "HELLO WORLD" banner and exits 0, `npm test` passes against the pure
renderer, the runtime dependency surface is empty, and the README gets a newcomer from clone to
banner in seconds. The three tasks meet at one seam — the test script in `package.json` (T02)
runs the test file authored in T01, and the README showcase (T03) reflects the banner T01/T02
produce.

## Tasks

| Task | Repo | Complexity | What it does |
|---|---|---|---|
| T01 | RAD-MASTER-BENCH-V2 | standard | The heart of the project: a pure module that turns the literal text "HELLO WORLD" into a single |
| T02 | RAD-MASTER-BENCH-V2 | simple | The thin shell around the renderer: an entrypoint that prints the banner exactly once and exits |
| T03 | RAD-MASTER-BENCH-V2 | simple | The front door: a README that takes a newcomer from clone to banner in seconds and shows the |

**Order:** T01 → T02 → T03
