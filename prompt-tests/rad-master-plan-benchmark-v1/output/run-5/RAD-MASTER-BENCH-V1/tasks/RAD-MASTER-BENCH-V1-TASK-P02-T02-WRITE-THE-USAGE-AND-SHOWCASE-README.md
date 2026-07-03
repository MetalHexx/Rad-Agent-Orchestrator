---
project: RAD-MASTER-BENCH-V1
phase: 2
task: 2
title: Write the usage and showcase README
status: pending
requirement_tags:
  - FR-8
  - NFR-1
  - NFR-2
  - NFR-3
  - NFR-5
  - AD-4
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T21:19:55.172Z'
type: task_handoff
---

# P02-T02: Write the usage and showcase README

Establishes the README that documents how to install and run the CLI, the supported Node version, the modern-terminal expectation, and a static plain-text showcase of the banner output. This is the shareable front door that frames the project as dependency-free and small.

**Task type:** doc
**Requirements:** FR-8, NFR-1, NFR-2, NFR-3, NFR-5, AD-4
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `README.md`

- [ ] **Step 1: Author the full README (FR-8, NFR-1, NFR-2, NFR-3, NFR-5, AD-4)**
    Create `README.md` with the title, dependency-free framing, requirements (Node 18+, ANSI terminal), install and usage instructions, a static plain-text showcase that matches the renderer output, and the test command:
    ````markdown
    # Rainbow HELLO WORLD

    Prints **HELLO WORLD** as large, blocky ASCII-art letters, each colored through a repeating seven-color rainbow (red, orange, yellow, green, cyan, blue, purple), then exits cleanly. It uses only Node.js built-in modules — zero runtime dependencies.

    ## Requirements

    - **Node.js 18 or newer** (modern LTS). The floor is enforced by the `engines` field in `package.json`.
    - A terminal with **ANSI / 256-color support** — modern macOS and Linux terminals, and Windows Terminal. Legacy terminals without ANSI support are out of scope.

    ## Installation

    ```bash
    git clone <repository-url>
    cd rad-master-bench-v1
    ```

    There is nothing to install: the project pulls in no runtime dependencies.

    ## Usage

    ```bash
    npm start
    ```

    or equivalently:

    ```bash
    node index.js
    ```

    The banner prints exactly once and the process exits. Any command-line arguments are ignored and no input is read from stdin.

    ## Showcase

    In an ANSI terminal each letter is rainbow-colored. Rendered as plain text the banner looks like this:

    ```
    #   # ##### #     #      ###        #   #  ###  ####  #     ####
    #   # #     #     #     #   #       #   # #   # #   # #     #   #
    ##### ####  #     #     #   #       # # # #   # ####  #     #   #
    #   # #     #     #     #   #       ## ## #   # #  #  #     #   #
    #   # ##### ##### #####  ###        #   #  ###  #   # ##### ####
    ```

    ## Testing

    ```bash
    npm test
    ```

    This runs the Node.js built-in test runner (`node --test`) over the unit tests, which assert the banner's row structure and the presence of ANSI color codes.
    ````
- [ ] **Step 2: Verify the README documents install, usage, and the Node 18 floor (FR-8, NFR-2)**
    Run: `node -e "const r=require('fs').readFileSync('README.md','utf8'); process.exit(r.includes('npm start') && /Node\.js 18/.test(r) && r.includes('node --test') ? 0 : 1)"`
    Expected: exit 0 — the README names the run command, the Node 18 floor, and the built-in test runner (FR-8, NFR-2, AD-4)
- [ ] **Step 3: Verify the showcase block matches the rendered banner (FR-8, NFR-5)**
    Run: `node -e "const {renderBanner}=require('./renderer'); const r=require('fs').readFileSync('README.md','utf8'); const lines=renderBanner().replace(/\x1b\[[0-9;]*m/g,'').split('\n').map(l=>l.trimEnd()).filter(Boolean); for(const l of lines){ if(!r.includes(l)){ console.error('missing showcase line'); process.exit(1);} } console.log('ok');"`
    Expected: prints `ok` and exits 0 — every plain banner row appears in the README showcase, keeping docs and output in sync (FR-8, NFR-5)
