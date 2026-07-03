---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 1
title: Scaffold project manifest and scripts
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
created: '2026-06-29T21:19:55.172Z'
type: task_handoff
---

# P01-T01: Scaffold project manifest and scripts

Establishes the package manifest that pins the Node 18+ runtime, exposes `npm start` and `npm test`, and guarantees an empty runtime-dependency set. This is the contract that ties the two source modules together and keeps the project dependency-free.

**Task type:** config
**Requirements:** FR-6, NFR-1, NFR-2, AD-4, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `package.json`

- [ ] **Step 1: Author package.json with metadata, engines, and scripts (NFR-2, AD-5)**
    Create `package.json` declaring the entrypoint, the Node 18+ engines floor, the `start` and `test` scripts, and empty dependency blocks:
    ```json
    {
      "name": "rad-master-bench-v1",
      "version": "1.0.0",
      "description": "Print HELLO WORLD as large rainbow ASCII-art in the terminal, dependency-free.",
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
      "devDependencies": {},
      "license": "MIT"
    }
    ```
- [ ] **Step 2: Confirm start and test scripts resolve to the entrypoint and built-in runner**
    Run: `node -e "const p=require('./package.json'); if(p.scripts.start!=='node index.js'||p.scripts.test!=='node --test')process.exit(1)"`
    Expected: exit 0 — `start` runs the entrypoint and `test` runs the Node built-in runner (FR-6, AD-4)
- [ ] **Step 3: Confirm the runtime dependency set is empty**
    Run: `node -e "const p=require('./package.json'); if(Object.keys(p.dependencies||{}).length)process.exit(1)"`
    Expected: exit 0 — no runtime dependencies are declared (NFR-1)
- [ ] **Step 4: Confirm the Node 18+ engines floor is declared**
    Run: `node -e "const p=require('./package.json'); if(!/>=\s*18/.test(p.engines.node))process.exit(1)"`
    Expected: exit 0 — the engines field pins Node 18 or newer (NFR-2)
