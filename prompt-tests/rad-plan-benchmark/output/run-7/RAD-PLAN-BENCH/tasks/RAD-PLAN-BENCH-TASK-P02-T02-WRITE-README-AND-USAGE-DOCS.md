---
project: RAD-PLAN-BENCH
phase: 2
task: 2
title: Write README and usage docs
status: pending
requirement_tags:
  - FR-8
  - NFR-1
  - NFR-2
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T20:51:11.320Z'
type: task_handoff
---

# P02-T02: Write README and usage docs

Establishes the user-facing documentation: install steps, how to run via `node index.js` and `npm start`, the supported Node version, and a static showcase of the banner. This is the doc surface that makes the project shareable.

**Task type:** doc
**Requirements:** FR-8, NFR-1, NFR-2
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the README skeleton and usage (FR-8)**
    Create `README.md` with a title, a one-line description, and a "Usage" section documenting both invocations:
    ```markdown
    # RAD-PLAN-BENCH

    A zero-dependency Node.js CLI that prints "HELLO WORLD" in large rainbow ASCII art.

    ## Usage

    ```bash
    node index.js
    # or
    npm start
    ```
    ```
    The two documented commands must match the `start` script and entrypoint shipped in P02-T01 (FR-8).

- [ ] **Step 2: Document requirements and zero-dependency footprint (NFR-1, NFR-2)**
    Add a "Requirements" section stating the project needs Node.js 18+ and has no runtime dependencies (the CLI runs from a bare checkout). Note that tests run with `npm test` on Node's built-in runner (NFR-1, NFR-2).

- [ ] **Step 3: Add the banner showcase (FR-8)**
    Add a "Showcase" section with a fenced code block showing the static ASCII-art layout of "HELLO WORLD" (uncolored, since markdown cannot render ANSI) so readers see the shape before running it (FR-8).
</content>
