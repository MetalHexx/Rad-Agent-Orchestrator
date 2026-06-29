---
project: RAD-MASTER-BENCH-V1
phase: 2
task: 1
title: Author usage README
status: pending
requirement_tags:
  - FR-8
  - NFR-2
  - NFR-5
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:42:01.677Z'
type: task_handoff
---

# P02-T01: Author usage README

Ships a concise, scannable README that lets a developer install, run, and recognize the banner output at a glance, with the supported Node version stated explicitly.

**Task type:** doc
**Requirements:** FR-8, NFR-2, NFR-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `README.md`

- [ ] **Step 1: Write the README structure, requirements, and usage sections (FR-8, NFR-2)**
    Create `README.md` with the overview, requirements (Node.js 18 or newer; zero runtime dependencies), installation, and usage sections shown below.
    ````markdown
    # RAD-MASTER-BENCH-V1

    Prints **HELLO WORLD** as large rainbow-colored ASCII-art letters, then exits.

    ## Requirements

    - Node.js 18 or newer. The CLI uses only Node.js built-in modules and has zero
      runtime dependencies, so there is nothing to install beyond Node itself.

    ## Installation

    ```bash
    git clone <repo-url>
    cd RAD-MASTER-BENCH-V1
    ```

    No `npm install` step is required — the `dependencies` block is empty.

    ## Usage

    ```bash
    npm start
    # equivalent to:
    node index.js
    ```

    The banner prints once and the process exits with status 0.
    ````

- [ ] **Step 2: Add the static showcase and testing sections (FR-8, NFR-5)**
    Append the showcase and testing sections below to `README.md`. The showcase is a static, monochrome rendering of the live output (which prints in a per-letter rainbow), kept short so the whole file stays scannable.
    ````markdown
    ## Showcase

    The live banner colors each letter through a red → orange → yellow → green →
    cyan → blue → purple cycle. Rendered monochrome, it looks like this:

    ```
    #   # ##### #     #      ###      #   #  ###  ####  #     ####
    #   # #     #     #     #   #     #   # #   # #   # #     #   #
    ##### ####  #     #     #   #     # # # #   # ####  #     #   #
    #   # #     #     #     #   #     ## ## #   # #  #  #     #   #
    #   # ##### ##### ##### #   #     #   #  ###  #   # ##### ####
    ```

    ## Testing

    ```bash
    npm test
    ```

    Runs the Node.js built-in test runner against the renderer and the spawned CLI.
    ````

- [ ] **Step 3: Proofread the README for accuracy and scannability (FR-8, NFR-5)**
    Read `README.md` end to end and confirm: the stated Node version matches the `engines` field, the run commands (`npm start`, `node index.js`, `npm test`) are correct and copy-pasteable, the showcase reads as "HELLO WORLD", and the document is short enough to scan in under a minute (FR-8, NFR-2, NFR-5).
