---
project: RAD-PLAN-BENCH
phase: 1
task: 1
title: Scaffold project manifest and layout
status: pending
requirement_tags:
  - FR-7
  - AD-5
  - NFR-1
  - NFR-3
  - NFR-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:16:35.234Z'
type: task_handoff
---

# P01-T01: Scaffold project manifest and layout

Establishes the npm package skeleton — metadata, run/test scripts, the single
`chalk` dependency, and a consistent CommonJS module system — so later tasks have
a runnable, installable home.

**Task type:** config
**Requirements:** FR-7, AD-5, NFR-1, NFR-3, NFR-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `package.json`

- [ ] **Step 1: Write the project manifest**
    Create `package.json` declaring metadata, the `start` and `test` scripts, a
    Node 18+ engine target, CommonJS module resolution (no `"type"` field), and
    `chalk@^4.1.2` as the single runtime dependency — `chalk` v4 is the
    CommonJS-compatible line and is the only permitted third-party runtime
    dependency (FR-7, AD-5, NFR-1, NFR-3, NFR-4):
    ```json
    {
      "name": "rad-plan-bench",
      "version": "1.0.0",
      "description": "Prints a colorful ASCII-art HELLO WORLD banner.",
      "main": "index.js",
      "scripts": {
        "start": "node index.js",
        "test": "node --test"
      },
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "dependencies": {
        "chalk": "^4.1.2"
      }
    }
    ```

- [ ] **Step 2: Install the dependency set**
    Run: `npm install`
    Expected: completes successfully and writes `node_modules/chalk` plus a
    lockfile, with `chalk` as the only direct dependency (NFR-1, FR-7)

- [ ] **Step 3: Verify the runtime and dependency resolve**
    Run: `node -e "console.log(require('chalk').level !== undefined)"`
    Expected: prints `true`, confirming the Node runtime loads `chalk` under
    CommonJS resolution (AD-5, NFR-3, NFR-1)
