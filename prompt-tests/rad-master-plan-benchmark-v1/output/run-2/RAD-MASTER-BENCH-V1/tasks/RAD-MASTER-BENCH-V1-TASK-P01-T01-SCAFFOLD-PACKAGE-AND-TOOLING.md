---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 1
title: Scaffold package and tooling
status: pending
requirement_tags:
  - FR-6
  - NFR-1
  - NFR-2
  - AD-4
  - AD-5
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:22:57.619Z'
type: task_handoff
---

# P01-T01: Scaffold package and tooling

Establishes the project skeleton: a `package.json` declaring the modern-Node baseline, the `start`/`test` scripts, and an empty runtime-dependency surface. This is the contract that ties the renderer module and entrypoint together and makes `npm start` / `npm test` work.

**Task type:** config
**Requirements:** FR-6, NFR-1, NFR-2, AD-4, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `package.json`

- [ ] **Step 1: Author `package.json` with the engines, scripts, and empty-dependency posture (FR-6, NFR-1, NFR-2, AD-4, AD-5)**
    Create `package.json` at the project root with exactly this content. The `start` script makes `npm start` equivalent to `node index.js`, the `test` script invokes Node's built-in runner, `engines.node` pins the modern-LTS baseline, and both dependency blocks are empty so the shipped CLI carries no runtime dependencies.
    ```json
    {
      "name": "rad-master-bench-v1",
      "version": "1.0.0",
      "description": "Prints HELLO WORLD as large rainbow-colored ASCII-art in the terminal.",
      "private": true,
      "type": "commonjs",
      "main": "index.js",
      "engines": {
        "node": ">=18"
      },
      "scripts": {
        "start": "node index.js",
        "test": "node --test"
      },
      "dependencies": {},
      "devDependencies": {}
    }
    ```

- [ ] **Step 2: Confirm the runtime baseline meets the declared engine**
    Run: `node --version`
    Expected: prints `v18.x` or newer, matching the `engines.node` `>=18` declaration (NFR-2)

- [ ] **Step 3: Confirm the runtime-dependency surface is empty**
    Run: `npm pkg get dependencies`
    Expected: prints `{}`, confirming no runtime dependencies are declared (NFR-1)

- [ ] **Step 4: Confirm the lifecycle scripts resolve**
    Run: `npm run`
    Expected: lists both `start` and `test` scripts, so `npm start` runs the entrypoint and `npm test` runs the built-in test runner (FR-6, AD-4)
