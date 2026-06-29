---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 2
title: Wire CLI entrypoint and run-once behavior
status: pending
requirement_tags:
  - FR-4
  - FR-5
  - FR-6
  - NFR-4
  - AD-3
  - AD-5
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:42:01.677Z'
type: task_handoff
---

# P01-T02: Wire CLI entrypoint and run-once behavior

Establishes the runnable entrypoint that prints the banner exactly once and exits cleanly, ignoring any arguments, and locks that behavior with a spawned-process integration test.

**Task type:** code
**Requirements:** FR-4, FR-5, FR-6, NFR-4, AD-3, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `index.js`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing CLI integration test (FR-4, FR-5)**
    Create `test/cli.test.js` with the exact content below. It spawns the entrypoint as a child process and asserts a zero exit code, a colored banner on stdout, and identical behavior when extra arguments are supplied.
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const path = require('node:path');
    const { spawnSync } = require('node:child_process');

    const ENTRY = path.join(__dirname, '..', 'index.js');

    test('CLI prints the banner and exits with code 0', () => {
      const result = spawnSync(process.execPath, [ENTRY], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, /\x1b\[38;5;\d+m/);
      assert.ok(result.stdout.endsWith('\n'));
    });

    test('CLI ignores extra command-line arguments', () => {
      const result = spawnSync(process.execPath, [ENTRY, '--word', 'ignored', 'extra'], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, /\x1b\[38;5;\d+m/);
    });
    ```

- [ ] **Step 2: Run the CLI test, confirm it fails**
    Run: `node --test test/cli.test.js`
    Expected: FAIL — `index.js` does not exist, so the spawned process exits non-zero and `result.status` is not 0 (FR-4).

- [ ] **Step 3: Implement the entrypoint (FR-4, FR-5, NFR-4, AD-3, AD-5)**
    Create `index.js` with the exact content below. It is the only module that writes to stdout: it calls the pure renderer once, writes the result, and lets the process exit naturally with status 0 — never reading `process.argv` or stdin, and never looping.
    ```js
    'use strict';

    const { renderBanner } = require('./renderer');

    process.stdout.write(renderBanner());
    ```

- [ ] **Step 4: Run the full test suite, confirm it passes**
    Run: `npm test`
    Expected: PASS — renderer and CLI tests all pass; the CLI prints once and exits 0 regardless of arguments, and `npm start` now resolves to the working entrypoint (FR-4, FR-5, FR-6).
