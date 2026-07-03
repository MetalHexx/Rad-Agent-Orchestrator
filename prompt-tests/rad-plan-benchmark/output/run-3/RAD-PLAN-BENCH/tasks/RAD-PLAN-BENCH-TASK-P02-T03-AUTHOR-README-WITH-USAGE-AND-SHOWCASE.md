---
project: RAD-PLAN-BENCH
phase: 2
task: 3
title: Author README with usage and showcase
status: pending
requirement_tags:
  - FR-6
  - NFR-1
  - NFR-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:18:41.578Z'
type: task_handoff
---

# P02-T03: Author README with usage and showcase

Document what the project is, how to install and run it, and show a sample of
the rendered banner. This task delivers the README that completes the shippable
package.

**Task type:** doc
**Requirements:** FR-6, NFR-1, NFR-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the project overview and run instructions (FR-6, NFR-4)**
    Create `README.md` opening with a one-line description of the project,
    then install and run instructions. State the Node 18+ requirement to match
    the declared engine baseline (NFR-4):
    ```markdown
    # RAD-PLAN-BENCH

    Prints **HELLO WORLD** as a large, blocky ASCII-art banner, each letter
    painted in a cycling rainbow of ANSI colors. It runs once, draws the
    banner, and exits.

    ## Requirements

    - Node.js 18 or newer.

    ## Install

    ```bash
    npm install
    ```

    ## Run

    ```bash
    npm start
    # or
    node index.js
    ```
    ```

- [ ] **Step 2: Add the banner showcase and dependency note (FR-6, NFR-1)**
    Append a showcase section that shows a sample of the rendered ASCII-art
    banner (FR-6) and a short note that the only runtime dependency is `chalk`,
    used for cross-platform color (NFR-1):
    ```markdown
    ## Showcase

    ```text
    H   H EEEEE L     L      OOO    W   W  OOO  RRRR  L     DDDD
    H   H E     L     L     O   O   W   W O   O R   R L     D   D
    HHHHH EEEE  L     L     O   O   W W W O   O RRRR  L     D   D
    H   H E     L     L     O   O   WW WW O   O R  R  L     D   D
    H   H EEEEE LLLLL LLLLL  OOO    W   W  OOO  R   R LLLLL DDDD
    ```

    Each letter is rendered in a rolling rainbow (red → orange → yellow →
    green → cyan → blue → purple) when run in a terminal.

    ## Dependencies

    The only runtime dependency is [`chalk`](https://www.npmjs.com/package/chalk),
    used for cross-platform ANSI color. Everything else is Node.js built-ins.
    ```

- [ ] **Step 3: Verify the documented commands work end-to-end (FR-6)**
    Run: `npm start`
    Expected: a centered, multicolored "HELLO WORLD" banner is drawn to the
    terminal and the process exits, confirming the README's run instructions
    are accurate (FR-6).
