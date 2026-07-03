---
project: RAD-MASTER-BENCH-V1
phase: 2
task: 2
title: Author the usage README
status: pending
requirement_tags:
  - FR-8
  - NFR-1
  - NFR-2
  - NFR-3
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:22:57.619Z'
type: task_handoff
---

# P02-T02: Author the usage README

Establishes the newcomer-facing documentation: install steps, how to run, the supported Node version, the zero-dependency note, and a static showcase of the banner. This is the "shareable, finished" surface a developer trying the toolchain sees first.

**Task type:** doc
**Requirements:** FR-8, NFR-1, NFR-2, NFR-3
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `README.md`

- [ ] **Step 1: Author the README with install, run, version, dependency, and showcase sections (FR-8, NFR-1, NFR-2, NFR-3)**
    Create `README.md` with exactly the content below. It documents the modern-Node requirement and ANSI-terminal expectation, the install and run commands, the empty runtime-dependency posture, a monochrome static showcase of the banner, and how to run the tests.
    ````markdown
    # rad-master-bench-v1

    Prints **HELLO WORLD** as large, rainbow-colored ASCII-art in your terminal — zero runtime dependencies, one quick run.

    ## Requirements

    - Node.js 18 or newer (modern LTS).
    - A terminal with ANSI escape support: modern macOS/Linux terminals or Windows Terminal. Legacy terminals without ANSI support are out of scope.

    ## Install

    ```bash
    git clone <repo-url>
    cd rad-master-bench-v1
    npm install
    ```

    `npm install` pulls nothing at runtime — the project depends only on Node.js built-in modules.

    ## Run

    ```bash
    npm start
    # equivalent to:
    node index.js
    ```

    The banner prints once and the process exits immediately. Command-line arguments are ignored.

    ## Output

    Each letter cycles through a seven-color rainbow — red, orange, yellow, green, cyan, blue, purple — wrapping back to red. Monochrome preview of the blocky layout (colors are applied per letter at runtime):

    ```
    #   #  #####  #      #       ###      #   #   ###   ####   #      ####
    #   #  #      #      #      #   #     #   #  #   #  #   #  #      #   #
    #####  ####   #      #      #   #     # # #  #   #  ####   #      #   #
    #   #  #      #      #      #   #     ## ##  #   #  #  #   #      #   #
    #   #  #####  #####  #####   ###      #   #   ###   #   #  #####  ####
    ```

    ## Test

    ```bash
    npm test
    ```

    Runs the Node.js built-in test runner (`node --test`), asserting the banner row count and the presence of ANSI color codes.
    ````

- [ ] **Step 2: Verify the documented run command produces the banner**
    Run: `npm start`
    Expected: the rainbow ASCII-art "HELLO WORLD" banner prints once and the process exits, matching the README's Run and Output sections on a modern ANSI terminal (FR-8, NFR-3)

- [ ] **Step 3: Verify the documented zero-dependency claim**
    Run: `npm pkg get dependencies`
    Expected: prints `{}`, confirming the README's "depends only on Node.js built-in modules" statement (NFR-1)

- [ ] **Step 4: Verify the documented Node version baseline**
    Run: `npm pkg get engines.node`
    Expected: prints `">=18"`, confirming the README's "Node.js 18 or newer" requirement (NFR-2)
