---
project: RAD-PLAN-BENCH
phase: 2
task: 2
title: Author README usage and showcase
status: pending
requirement_tags:
  - FR-6
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:16:35.234Z'
type: task_handoff
---

# P02-T02: Author README usage and showcase

Establishes the README so a reader understands and can run the program — install
and run instructions plus a showcase of the ASCII-art output before they execute
it.

**Task type:** doc
**Requirements:** FR-6
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the README with install, usage, and showcase (FR-6)**
    Create `README.md` documenting what the program produces, how to install and
    run it (`npm install`, then `npm start` or `node index.js`), how to run the
    tests (`npm test`), and a fenced showcase block of the ASCII-art banner so the
    output is visible before running:
    ```markdown
    # RAD-PLAN-BENCH

    A tiny Node.js CLI that prints "HELLO WORLD" as a large, blocky ASCII-art
    banner with each letter painted a different rainbow color, then exits.

    ## Showcase

    ```
    #   #  #####  #     #     #####     #   #  #####  ####   #     ####
    #   #  #      #     #     #   #     #   #  #   #  #   #  #     #   #
    #####  ####   #     #     #   #     # # #  #   #  ####   #     #   #
    #   #  #      #     #     #   #     ## ##  #   #  #  #   #     #   #
    #   #  #####  #####  #####  #####     #   #  #####  #   #  #####  ####
    ```

    (Each letter is rendered in a distinct rainbow hue in your terminal.)

    ## Install

    ```sh
    npm install
    ```

    ## Run

    ```sh
    npm start
    # or
    node index.js
    ```

    ## Test

    ```sh
    npm test
    ```

    ## Requirements

    - Node.js 18 or newer
    ```

- [ ] **Step 2: Verify the README renders and matches the program (FR-6)**
    Run: `node -e "const fs=require('fs');const r=fs.readFileSync('README.md','utf8');if(!/npm start/.test(r)||!/Showcase/.test(r))process.exit(1);console.log('README OK')"`
    Expected: prints `README OK`, confirming the README documents the run command
    and includes the output showcase (FR-6)
