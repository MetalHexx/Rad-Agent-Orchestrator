---
project: RAD-MASTER-BENCH-V2
phase: 1
title: Rainbow Hello-World CLI
status: active
tasks:
  - id: T01
    title: Build the runnable rainbow-hello CLI
  - id: T02
    title: Write usage README with showcase
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:09:44.964Z'
type: phase_plan
---

# Phase 1: Rainbow Hello-World CLI

When this phase completes the project is a runnable, tested, documented CLI: `npm start` (and
`node index.js`) prints a rainbow "HELLO WORLD" banner once and exits 0, `npm test` passes
against the pure renderer with zero runtime dependencies installed, and the README shows the
output without running it. T01 builds and wires the entire CLI as one slice — pure core, I/O
shell, manifest, and test; T02 documents it.

## Tasks

| Task | Repo | Complexity | What it does |
|---|---|---|---|
| T01 | RAD-MASTER-BENCH-V2 | standard | The whole working CLI as one vertical slice: a pure renderer that assembles "HELLO WORLD" as |
| T02 | RAD-MASTER-BENCH-V2 | simple | Document the CLI so a newcomer goes from clone to banner in seconds: how to run it, the |

**Order:** T01 → T02
