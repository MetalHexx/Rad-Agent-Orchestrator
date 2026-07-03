---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 1
title: Scaffold package manifest and scripts
status: pending
requirement_tags:
  - FR-6
  - NFR-1
  - NFR-2
  - NFR-5
  - AD-4
  - AD-5
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:58:10.234Z'
type: task_handoff
---

# P01-T01: Scaffold package manifest and scripts

Establishes the package metadata that ties the two source files together and pins the zero-dependency, Node 18+ posture. Wires `npm start` and `npm test` to the built-in toolchain.

**Task type:** config
**Requirements:** FR-6, NFR-1, NFR-2, NFR-5, AD-4, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `package.json`

- [ ] **Step 1: Create the package manifest (NFR-1, NFR-2, NFR-5, AD-4, AD-5)**
    Create `package.json` at the repo root. The `dependencies` block stays empty so the shipped CLI pulls in only Node built-ins; the `engines.node` field pins the modern-LTS baseline; `start` runs the entrypoint and `test` runs Node's built-in runner. The manifest names `index.js` as the package main, tying the entrypoint and renderer module together.

    ```json
    {
      "name": "rad-master-bench-v1",
      "version": "1.0.0",
      "description": "Prints HELLO WORLD as rainbow ASCII-art in the terminal.",
      "main": "index.js",
      "scripts": {
        "start": "node index.js",
        "test": "node --test"
      },
      "engines": {
        "node": ">=18"
      },
      "license": "MIT",
      "dependencies": {},
      "devDependencies": {}
    }
    ```

- [ ] **Step 2: Confirm the start and test scripts are wired (FR-6, AD-4)**
    Run: `npm pkg get scripts`
    Expected: prints `{ "start": "node index.js", "test": "node --test" }`, confirming `npm start` is equivalent to `node index.js` and `npm test` invokes the built-in `node --test` runner (FR-6, AD-4).

- [ ] **Step 3: Confirm zero runtime dependencies and the engine baseline (NFR-1, NFR-2)**
    Run: `npm pkg get dependencies engines.node`
    Expected: prints an empty `dependencies` object (`{}`) and the string `">=18"`, confirming no runtime dependencies and the Node 18+ target (NFR-1, NFR-2).
