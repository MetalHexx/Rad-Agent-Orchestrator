---
project: RAD-MASTER-BENCH-V1
phase: 2
task: 2
title: Write usage and showcase README
status: pending
requirement_tags:
  - FR-8
  - NFR-2
  - NFR-5
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:58:10.234Z'
type: task_handoff
---

# P02-T02: Write usage and showcase README

Establishes user-facing documentation: how to install and run the CLI, the supported Node version, and a static showcase of the rainbow banner.

**Task type:** doc
**Requirements:** FR-8, NFR-2, NFR-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `README.md`

- [ ] **Step 1: Author the README (FR-8, NFR-2, NFR-5)**
    Create `README.md` documenting the supported Node version, installation, how to run via both `npm start` and `node index.js`, the no-arguments behavior, the test command, and a static showcase of the banner output. The showcase is a plain-text rendering of the glyphs (color is described in prose since ANSI codes do not render in Markdown).

    ```markdown
    # RAD-MASTER-BENCH-V1

    Prints **HELLO WORLD** as large, rainbow-colored ASCII-art in your terminal —
    zero runtime dependencies, one command.

    ## Requirements

    - Node.js 18 or newer (modern LTS).

    ## Installation

    Clone the repository (there are no runtime dependencies to install):

    ```sh
    git clone <repo-url>
    cd RAD-MASTER-BENCH-V1
    ```

    ## Usage

    Run the banner with either command — they are equivalent:

    ```sh
    npm start
    # or
    node index.js
    ```

    The program prints the banner once and exits with status 0. It takes no flags
    or arguments and reads no input; extra arguments are ignored.

    ## Showcase

    Each letter is rendered in a repeating rainbow:
    red -> orange -> yellow -> green -> cyan -> blue -> purple.

    ```text
    #   #  #####  #      #       ###     #   #   ###   ####   #      ####
    #   #  #      #      #      #   #    #   #  #   #  #   #  #      #   #
    #####  ####   #      #      #   #    # # #  #   #  ####   #      #   #
    #   #  #      #      #      #   #    ## ##  #   #  #  #   #      #   #
    #   #  #####  #####  #####   ###     #   #   ###   #   #  #####  ####
    ```

    ## Testing

    ```sh
    npm test
    ```

    Runs the unit tests on Node's built-in test runner (`node --test`).

    ## License

    MIT
    ```

- [ ] **Step 2: Verify the README covers the required sections (FR-8, NFR-2)**
    Run: `node -e "const fs=require('fs');const r=fs.readFileSync('README.md','utf8');for(const s of ['Installation','Usage','Showcase','npm start','node index.js','18']){if(!r.includes(s))throw new Error('README missing: '+s);}console.log('README ok');"`
    Expected: prints `README ok`, confirming the README documents installation, usage (both run commands), the showcase, and the supported Node version (FR-8, NFR-2).
