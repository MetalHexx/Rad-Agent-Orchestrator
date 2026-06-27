---
project: RAD-PLAN-BENCH
phase: 1
task: 1
title: Scaffold ESM project and dependencies
status: pending
requirement_tags:
  - FR-3
  - NFR-1
  - NFR-3
  - AD-3
  - AD-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:18:51.301Z'
type: task_handoff
---

# P01-T01: Scaffold ESM project and dependencies

Stand up the project manifest so the runtime engine, the lone `chalk` dependency, and the `start`/`test` entrypoints are declared and resolvable. This establishes the minimal, single-dependency ESM footprint the rest of the work builds on.

**Task type:** config
**Requirements:** FR-3, NFR-1, NFR-3, AD-3, AD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `package.json`

- [ ] **Step 1: Author `package.json` with ESM, engine baseline, scripts, and the single dependency**
    Create `package.json` exactly as below. `"type": "module"` enables ESM for chalk v5; `engines.node` declares the Node 18+ baseline (NFR-3); `chalk` is the only production dependency (NFR-1); the `start` script aliases `node index.js` (FR-3, AD-3) and `test` runs the built-in runner (AD-4).
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
      "license": "MIT",
      "dependencies": {
        "chalk": "^5.3.0"
      }
    }
    ```

- [ ] **Step 2: Install the single production dependency**
    Run: `npm install`
    Expected: command exits 0; `chalk` resolves into `node_modules/chalk` and no other production dependency is added (NFR-1).

- [ ] **Step 3: Verify chalk resolves under ESM and reports a color level**
    Run: `node --input-type=module -e "import chalk from 'chalk'; process.stdout.write(String(chalk.level))"`
    Expected: prints a single digit `0`–`3` — chalk imported successfully under ESM and negotiated a terminal color level rather than throwing (NFR-1, NFR-2).
