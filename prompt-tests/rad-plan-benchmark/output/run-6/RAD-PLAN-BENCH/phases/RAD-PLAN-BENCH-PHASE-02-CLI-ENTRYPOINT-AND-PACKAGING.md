---
project: RAD-PLAN-BENCH
phase: 2
title: CLI Entrypoint and Packaging
status: active
tasks:
  - id: T01
    title: Wire CLI entrypoint and npm scripts
  - id: T02
    title: Write README and run docs
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:56:44.089Z'
type: phase_plan
---

# Phase 2: CLI Entrypoint and Packaging

Delivers the runnable CLI surface around the renderer: a single-invocation entrypoint that prints the banner once and exits 0, npm `start`/`test` scripts, the Node 18+ engine constraint with zero runtime dependencies, and user-facing documentation. When the phase completes, a clean checkout runs end-to-end via `npm start`.

**Requirements:** FR-4, FR-5, FR-6, FR-8, NFR-1, NFR-2, NFR-4, AD-3
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02

## Tasks

- **T01**: Wire CLI entrypoint and npm scripts
- **T02**: Write README and run docs
