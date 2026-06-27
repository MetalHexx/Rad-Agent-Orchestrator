---
project: RAD-PLAN-BENCH
phase: 2
task: 3
title: Write README usage and showcase
status: pending
requirement_tags:
  - FR-6
  - FR-5
  - NFR-3
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:35:15.252Z'
type: task_handoff
---

# P02-T03: Write README usage and showcase

Ships a README that explains installing and running the program and shows a representation of the banner so a reader understands the result before running it. This is the final piece that makes the project reproducible and shareable.

**Task type:** doc
**Requirements:** FR-6, FR-5, NFR-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the README with install, run, and showcase sections (FR-6, FR-5, NFR-3)**
    Create `README.md` with the content below. It states the Node 18+ floor (NFR-3), documents both `npm start` and the direct `node index.js` invocation (FR-5), and shows a plain-text representation of the banner so the result is understood before running (FR-6).
    ````markdown
    # RAD-PLAN-BENCH

    A tiny Node.js CLI that prints **HELLO WORLD** as a large, blocky ASCII-art
    banner, painting each letter a different rainbow hue, then exits.

    ## Requirements

    - Node.js 18 LTS or newer.

    ## Install

    ```bash
    npm install
    ```

    ## Run

    ```bash
    npm start
    # or, equivalently:
    node index.js
    ```

    Both commands print the same centered, rainbow-colored banner and exit.

    ## What you'll see

    The banner renders in color in your terminal; here it is without color:

    ```
    #   # ##### #     #      ###    #   #  ###  ####  #     ####
    #   # #     #     #     #   #   #   # #   # #   # #     #   #
    ##### ####  #     #     #   #   # # # #   # ####  #     #   #
    #   # #     #     #     #   #   ## ## #   # #  #  #     #   #
    #   # ##### ##### #####  ###    #   #  ###  #   # ##### ####
    ```

    ## Test

    ```bash
    npm test
    ```
    ````

- [ ] **Step 2: Verify the README renders and the commands it documents are accurate (FR-6, FR-5)**
    Run: `npm start`
    Expected: a centered rainbow "HELLO WORLD" banner prints and the process exits, matching the invocation and showcase the README documents (FR-6, FR-5).
