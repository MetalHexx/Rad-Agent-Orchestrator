---
project: RAD-MASTER-BENCH-V2
phase: 1
title: Rainbow Hello-World CLI
status: active
tasks:
  - id: T01
    title: Build pure rainbow renderer and unit test
  - id: T02
    title: Wire entrypoint and zero-dependency manifest
  - id: T03
    title: Write usage README with showcase
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T02:40:09.823Z'
type: phase_plan
---

# Phase 1: Rainbow Hello-World CLI

When this phase completes the project is a runnable, tested, documented CLI: `npm start`
prints a rainbow "HELLO WORLD" banner and exits 0, `npm test` passes against the pure
renderer, and the README shows the output without running it. T01 builds the pure core the
other two slices depend on; T02 wraps it in a runnable zero-dep shell; T03 documents it.

## Tasks

| Task | Repo | Complexity | What it does |
|---|---|---|---|
| T01 | RAD-MASTER-BENCH-V2 | standard | The core of the project: a pure module that assembles "HELLO WORLD" as multi-line ASCII-art |
| T02 | RAD-MASTER-BENCH-V2 | simple | Wrap the pure renderer in the runnable CLI: a one-shot `index.js` that prints the banner once |
| T03 | RAD-MASTER-BENCH-V2 | simple | Document the CLI so a newcomer goes from clone to banner in seconds: how to run it, the |

**Order:** T01 → T02 → T03
