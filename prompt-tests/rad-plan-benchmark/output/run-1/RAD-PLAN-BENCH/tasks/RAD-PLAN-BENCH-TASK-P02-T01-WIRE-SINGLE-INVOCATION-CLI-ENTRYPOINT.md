---
project: RAD-PLAN-BENCH
phase: 2
task: 1
title: Wire single-invocation CLI entrypoint
status: pending
requirement_tags:
  - FR-1
  - AD-3
  - AD-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:16:35.234Z'
type: task_handoff
---

# P02-T01: Wire single-invocation CLI entrypoint

Establishes `index.js` as the runnable entrypoint that composes the pure banner
builder with a single synchronous `console.log` and exits cleanly, taking no
arguments and reading no input.

**Task type:** code
**Requirements:** FR-1, AD-3, AD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `index.js`
- Test: `index.test.js`

- [ ] **Step 1: Write the failing test (FR-1, AD-4)**
    Create `index.test.js` that spawns the entrypoint as a child process with
    color forced on, asserting it prints the five-line banner with ANSI codes and
    exits with a success status in a single synchronous pass (a non-zero exit
    would make `execFileSync` throw):
    ```js
    const { test } = require('node:test');
    const assert = require('node:assert/strict');
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');

    test('index.js prints the banner once and exits successfully', () => {
      const out = execFileSync('node', [path.join(__dirname, 'index.js')], {
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '3' },
      });
      const lines = out.replace(/\n$/, '').split('\n');
      assert.equal(lines.length, 5);
      assert.match(out, /\[/);
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `npm test`
    Expected: FAIL — `index.js` does not exist, so the child process exits
    non-zero and `execFileSync` throws (FR-1, AD-4)

- [ ] **Step 3: Implement the entrypoint (FR-1, AD-3, AD-4)**
    Create `index.js` that imports the pure builder and writes the banner once
    with a single `console.log`, keeping render logic separate from output and
    using no timers, async loops, or argument parsing — the program renders in
    one synchronous pass and exits:
    ```js
    const { buildBanner } = require('./render');

    console.log(buildBanner());
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `npm test`
    Expected: PASS — the entrypoint prints the five-line colored banner and exits
    with success (FR-1, AD-4)
