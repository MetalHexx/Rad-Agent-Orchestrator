---
project: RAD-MASTER-BENCH-V1
phase: 2
task: 1
title: Wire CLI entrypoint to print banner
status: pending
requirement_tags:
  - FR-4
  - FR-5
  - NFR-3
  - NFR-4
  - NFR-5
  - AD-5
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:58:10.234Z'
type: task_handoff
---

# P02-T01: Wire CLI entrypoint to print banner

Establishes the single-invocation entrypoint: it calls the pure renderer and writes the banner to stdout exactly once, ignoring all arguments and exiting with status 0.

**Task type:** code
**Requirements:** FR-4, FR-5, NFR-3, NFR-4, NFR-5, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `index.js`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing test (FR-4, FR-5)**
    Create `test/cli.test.js`. It spawns the entrypoint as a child process and asserts it exits with status 0 and emits a colored banner on stdout, both with no arguments and with extra unexpected arguments — proving the run-once, exit-0 lifecycle and the ignore-all-input behavior. Uses Node's built-in `node:test`, `node:assert`, and `node:child_process`.

    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { spawnSync } = require('node:child_process');
    const path = require('node:path');

    const ENTRY = path.join(__dirname, '..', 'index.js');
    const ANSI_COLOR = /\x1b\[38;5;\d+m/;

    function runCli(args) {
      return spawnSync(process.execPath, [ENTRY, ...(args || [])], {
        encoding: 'utf8',
      });
    }

    test('prints the banner and exits with status 0', () => {
      const result = runCli();
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, ANSI_COLOR);
    });

    test('ignores extra command-line arguments and still exits 0', () => {
      const result = runCli(['--word', 'nope', 'extra']);
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, ANSI_COLOR);
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/cli.test.js`
    Expected: FAIL — `index.js` does not exist yet, so the spawned process exits non-zero with empty stdout and the status/color assertions fail (FR-4).

- [ ] **Step 3: Implement the entrypoint (FR-4, FR-5, NFR-3, NFR-4, NFR-5, AD-5)**
    Create `index.js`. It requires the renderer module and writes the rendered banner to stdout exactly once. It reads neither `process.argv` nor stdin, so behavior is identical for any invocation; after the single synchronous write the process exits naturally with status 0. The output is a small fixed string, so the process completes effectively instantly.

    ```js
    'use strict';

    const { renderBanner } = require('./renderer');

    // Ignore argv and stdin entirely — behavior is identical for any invocation.
    // Write the banner exactly once; the process then exits naturally with code 0.
    process.stdout.write(renderBanner());
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/cli.test.js`
    Expected: PASS — the entrypoint prints a colored banner and exits 0 both with and without extra arguments (FR-4, FR-5).
