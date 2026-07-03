---
project: RAD-PLAN-BENCH
phase: 2
task: 2
title: Wire the CLI entrypoint
status: pending
requirement_tags:
  - FR-4
  - FR-5
  - NFR-5
  - AD-1
  - AD-5
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:18:41.578Z'
type: task_handoff
---

# P02-T02: Wire the CLI entrypoint

Provide the single no-argument entrypoint that draws the banner exactly once and
exits with success. This task delivers `index.js` and a process-level test
proving it prints color and exits zero.

**Task type:** code
**Requirements:** FR-4, FR-5, NFR-5, AD-1, AD-5
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `index.js`
- Test: `index.test.js`

- [ ] **Step 1: Write the failing test (FR-4, FR-5, NFR-5, AD-5)**
    Create `index.test.js`. It runs the entrypoint as a real process via
    `execFileSync` — which throws on any non-zero exit — and asserts the
    output carries ANSI color and the full banner height, proving the program
    prints once and exits with a success code (FR-4, NFR-5). It uses Node's
    built-in runner and child_process, adding no test dependency (AD-5):
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const path = require('node:path');
    const { execFileSync } = require('node:child_process');

    test('entrypoint prints a colored banner and exits zero', () => {
      const entry = path.join(__dirname, 'index.js');
      const out = execFileSync('node', [entry], { encoding: 'utf8' });
      assert.match(out, /\[/);
      assert.ok(out.split('\n').length >= 5, 'expected the full banner height');
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test index.test.js`
    Expected: FAIL — `execFileSync` errors because `index.js` does not exist
    yet, so `node index.js` exits non-zero (FR-4, FR-5).

- [ ] **Step 3: Implement the entrypoint (FR-4, NFR-5, AD-1)**
    Create `index.js` as a thin CommonJS wrapper with no framework (AD-1) that
    calls the render module once, writes the result to stdout with a trailing
    newline, and performs no further work so the process exits naturally with a
    success code immediately after printing (FR-4, NFR-5):
    ```js
    'use strict';

    const { renderBanner } = require('./render');

    process.stdout.write(renderBanner() + '\n');
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test index.test.js`
    Expected: PASS — `node index.js` prints the colored, centered banner once
    and exits zero, so `execFileSync` returns its captured output without
    throwing (FR-4, FR-5, NFR-5, AD-1).
