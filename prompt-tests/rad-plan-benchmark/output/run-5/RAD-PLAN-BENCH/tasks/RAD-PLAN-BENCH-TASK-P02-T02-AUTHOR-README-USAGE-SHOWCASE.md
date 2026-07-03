---
project: RAD-PLAN-BENCH
phase: 2
task: 2
title: Author README usage showcase
status: pending
requirement_tags:
  - FR-4
  - NFR-6
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:48:06.163Z'
type: task_handoff
---

# P02-T02: Author README usage showcase

Document installation, the run command, and the visual result so the project is self-evident to anyone cloning it. The README anchors the single-command run surface and shows an ASCII preview of the banner.

**Task type:** doc
**Requirements:** FR-4, NFR-6
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write install and usage sections (FR-4, NFR-6)**
    Create `README.md` with a title, one-line description, and an Install/Usage section documenting the single-command run surface:
    ```markdown
    # RAD-PLAN-BENCH

    Prints **HELLO WORLD** as large ASCII art, each letter painted across the rainbow.

    ## Install
    ```
    npm install
    ```

    ## Usage
    ```
    npm start
    ```
    Runs once, prints the banner, and exits. No flags, no config.
    ```
    The Usage section names `npm start` as the only command (FR-4, NFR-6).
- [ ] **Step 2: Add an ASCII preview and requirements note (NFR-6, NFR-2)**
    Append a "Preview" section showing the uncolored banner shape and a note that Node.js >= 18 is required:
    ```markdown
    ## Preview
    ```
    #   # #####         #     #     #####
    #   # #             #     #     #   #
    ##### ####          #     #     #   #
    #   # #             #     #     #   #
    #   # #####         #####  ##### #####
    ```
    > Colors render in any modern terminal (macOS, Linux, Windows Terminal); plain text elsewhere.

    Requires Node.js >= 18.
    ```
    The preview makes the output self-evident and records the runtime floor (NFR-6, NFR-2).
