---
project: RAD-PLAN-BENCH
phase: 1
task: 1
title: Scaffold project and dependencies
status: pending
requirement_tags:
  - AD-1
  - NFR-1
  - NFR-3
  - NFR-4
  - FR-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:18:41.578Z'
type: task_handoff
---

# P01-T01: Scaffold project and dependencies

Stand up the Node.js project manifest, the single `chalk` dependency, and the
`start`/`test` scripts so the program is runnable and testable. This task
delivers the project shell with no application framework.

**Task type:** config
**Requirements:** AD-1, NFR-1, NFR-3, NFR-4, FR-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Author `package.json` with scripts, engines, and the single dependency**
    Create `package.json` with exactly this content. It declares a plain
    CommonJS Node CLI with no framework (AD-1), pins `chalk` at the v4 line
    because v5 is ESM-only and this project uses `require()` (NFR-1, AD-1),
    declares Node 18+ via `engines` (NFR-4), and wires `start` (the single
    no-argument entrypoint) and `test` scripts (FR-4):
    ```json
    {
      "name": "rad-plan-bench",
      "version": "1.0.0",
      "description": "Prints HELLO WORLD as a rainbow ASCII-art banner.",
      "main": "index.js",
      "type": "commonjs",
      "scripts": {
        "start": "node index.js",
        "test": "node --test"
      },
      "engines": {
        "node": ">=18"
      },
      "dependencies": {
        "chalk": "^4.1.2"
      },
      "license": "MIT"
    }
    ```

- [ ] **Step 2: Add a `.gitignore` to keep the tree minimal**
    Create `.gitignore` excluding installed modules and OS noise so the
    repository stays small and dependency-light (NFR-1, NFR-3):
    ```gitignore
    node_modules/
    npm-debug.log*
    .DS_Store
    ```

- [ ] **Step 3: Install the dependency tree**
    Run: `npm install`
    Expected: `chalk@4.x` is added under `node_modules/` and a
    `package-lock.json` is written, with no other runtime dependencies pulled
    in (NFR-1, AD-1).

- [ ] **Step 4: Verify the Node baseline and script wiring**
    Run: `node -v` and confirm the major version is 18 or newer; then run
    `npm run` and confirm both `start` and `test` scripts are listed.
    Expected: Node major version >= 18 (NFR-4) and the `start` + `test`
    scripts are present and runnable (FR-4, AD-1).
