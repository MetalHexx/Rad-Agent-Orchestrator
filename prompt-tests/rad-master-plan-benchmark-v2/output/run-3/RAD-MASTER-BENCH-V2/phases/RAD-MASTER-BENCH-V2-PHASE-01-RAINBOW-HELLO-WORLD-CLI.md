---
project: RAD-MASTER-BENCH-V2
phase: 1
title: Rainbow HELLO WORLD CLI
status: active
tasks:
  - id: T01
    title: Build the runnable rainbow CLI
  - id: T02
    title: Write the usage README with showcase
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:21:00.745Z'
type: phase_plan
---

# Phase 1: Rainbow HELLO WORLD CLI

When this phase completes, `node index.js` (and `npm start`) prints the rainbow "HELLO WORLD"
banner once and exits 0, `npm test` passes against the pure renderer, the runtime dependency
surface is empty, and a README documents how to run it. The renderer/entrypoint/manifest/test
land as one slice (T01); the README documents the result (T02).

## Tasks

| Task | Repo | Complexity | What it does |
|---|---|---|---|
| T01 | RAD-MASTER-BENCH-V2 | standard | Build the complete, runnable program in one slice: a pure renderer module that owns the |
| T02 | RAD-MASTER-BENCH-V2 | simple | Write the project README so a newcomer goes from clone to banner in seconds: install/run steps, |

**Order:** T01 → T02
