---
project: RAD-PLAN-BENCH
phase: 1
task: 1
title: Scaffold project and tooling
status: pending
requirement_tags:
  - FR-4
  - NFR-1
  - NFR-2
  - AD-5
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:48:06.163Z'
type: task_handoff
---

# P01-T01: Scaffold project and tooling

Establish the Node.js project skeleton: package metadata, engine range, npm scripts, and the single chalk dependency. This task makes `npm start` and `npm test` resolvable and pins the runtime to modern LTS.

**Task type:** config
**Requirements:** FR-4, NFR-1, NFR-2, AD-5
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Author `package.json` with engines, scripts, and chalk dep (NFR-1, NFR-2, AD-5, FR-4)**
    Create `package.json` declaring ESM, the Node LTS engine floor, the two npm scripts, and chalk as the sole runtime dependency:
    ```json
    {
      "name": "rad-plan-bench",
      "version": "1.0.0",
      "description": "Prints HELLO WORLD as rainbow ASCII art.",
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
      },
      "license": "MIT"
    }
    ```
- [ ] **Step 2: Add `.gitignore` for node artifacts (NFR-1)**
    Create `.gitignore` so dependency and OS noise stays out of the repo:
    ```gitignore
    node_modules/
    npm-debug.log*
    .DS_Store
    ```
- [ ] **Step 3: Install dependencies and confirm scripts resolve (NFR-1, AD-5)**
    Run: `npm install`
    Expected: chalk installed under `node_modules/`; `npm start` and `npm test` are recognized scripts (NFR-1, AD-5).
