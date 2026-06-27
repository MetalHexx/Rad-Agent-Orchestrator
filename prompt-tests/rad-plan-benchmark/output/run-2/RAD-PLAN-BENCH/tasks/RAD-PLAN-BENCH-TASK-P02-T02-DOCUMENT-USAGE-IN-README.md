---
project: RAD-PLAN-BENCH
phase: 2
task: 2
title: Document usage in README
status: pending
requirement_tags:
  - FR-5
  - FR-3
  - AD-3
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:18:51.301Z'
type: task_handoff
---

# P02-T02: Document usage in README

Author the README so a newcomer can understand what the project does, install the single dependency, run it both supported ways, and see a sample of the rainbow output. This completes the usage-focused documentation surface.

**Task type:** doc
**Requirements:** FR-5, FR-3, AD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the README with purpose, install, run, and sample output**
    Create `README.md` with the content below. It states what the project does, how to install, both run paths (`node index.js` and `npm start`), and a fenced sample of the ASCII-art output (FR-5). The documented run commands match the `package.json` entrypoints (FR-3, AD-3).
    ```markdown
    # RAD-PLAN-BENCH

    A tiny Node.js CLI that prints **HELLO WORLD** as large, blocky ASCII-art
    letters, each painted a different color cycling through the rainbow. It runs
    once, prints its banner, and exits — no flags, no config.

    ## Requirements

    - Node.js 18 or newer.

    ## Install

    ```sh
    npm install
    ```

    The only runtime dependency is [`chalk`](https://github.com/chalk/chalk) for
    portable terminal color.

    ## Run

    Either command prints the same banner and exits:

    ```sh
    node index.js
    # or
    npm start
    ```

    ## Sample output

    Each letter is rendered in a rainbow color (red → orange → yellow → green →
    cyan → blue → purple), centered with padding:

    ```text
    #   # ##### #     #      ###    #   #  ###  ####  #     ####
    #   # #     #     #     #   #   #   # #   # #   # #     #   #
    ##### #### #     #     #   #   # # # #   # ####  #     #   #
    #   # #     #     #     #   #   ## ## #   # #  #  #     #   #
    #   # ##### ##### #####  ###    #   #  ###  #   # ##### ####
    ```

    ## Test

    ```sh
    npm test
    ```
    ```

- [ ] **Step 2: Verify the documented run command produces the banner**
    Run: `npm start`
    Expected: prints the centered, multi-line rainbow "HELLO WORLD" banner and exits 0, confirming the README's run instructions are accurate (FR-5, FR-3).
