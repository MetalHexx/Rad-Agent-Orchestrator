---
project: RAD-PLAN-BENCH
phase: 1
task: 1
title: Initialize package manifest and scripts
status: pending
requirement_tags:
  - FR-5
  - NFR-1
  - NFR-3
  - NFR-5
  - AD-2
  - AD-5
  - AD-6
  - NFR-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:35:15.252Z'
type: task_handoff
---

# P01-T01: Initialize package manifest and scripts

Establishes a runnable, testable project skeleton with `chalk` as the single dependency and the `start`/`test` scripts wired. After this task `npm test` executes the Node built-in runner and the Node 18 floor is declared.

**Task type:** config
**Requirements:** FR-5, NFR-1, NFR-3, NFR-5, AD-2, AD-5, AD-6, NFR-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Write `package.json` with scripts, engines, and the single dependency (AD-5, FR-5, NFR-3, AD-2)**
    Create `package.json` exactly as below. `type: module` enables ESM (chalk v5 is ESM-only); `start` runs the entrypoint and `test` runs the Node built-in runner; `engines` declares the Node 18 floor; `chalk` is the only runtime dependency (AD-5, FR-5, NFR-3, AD-2, AD-6).
    ```json
    {
      "name": "rad-plan-bench",
      "version": "1.0.0",
      "description": "Prints HELLO WORLD as a rainbow ASCII-art banner and exits.",
      "type": "module",
      "main": "index.js",
      "scripts": {
        "start": "node index.js",
        "test": "node --test"
      },
      "engines": {
        "node": ">=18"
      },
      "dependencies": {
        "chalk": "^5.3.0"
      }
    }
    ```

- [ ] **Step 2: Write `.gitignore` to keep the tree minimal (NFR-1, NFR-5)**
    Create `.gitignore` with the single line below so installed packages stay out of version control and the code surface remains tiny (NFR-1, NFR-5).
    ```gitignore
    node_modules/
    ```

- [ ] **Step 3: Install the single dependency (NFR-1, AD-2)**
    Run: `npm install chalk@^5.3.0`
    Expected: `node_modules/chalk` is created and `package-lock.json` is written; no other runtime dependency is added (NFR-1, AD-2).

- [ ] **Step 4: Verify the test script is wired to the Node built-in runner (AD-6, NFR-4)**
    Run: `npm test`
    Expected: PASS — the `node --test` runner executes and exits 0 (it reports 0 tests discovered, since none exist yet), confirming the test script is correctly wired (AD-6, NFR-4).
