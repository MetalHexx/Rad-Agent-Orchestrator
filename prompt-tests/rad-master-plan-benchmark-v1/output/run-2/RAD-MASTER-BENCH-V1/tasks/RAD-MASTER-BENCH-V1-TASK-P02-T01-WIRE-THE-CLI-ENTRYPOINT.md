---
project: RAD-MASTER-BENCH-V1
phase: 2
task: 1
title: Wire the CLI entrypoint
status: pending
requirement_tags:
  - FR-4
  - FR-5
  - NFR-4
  - AD-3
  - AD-5
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:22:57.619Z'
type: task_handoff
---

# P02-T01: Wire the CLI entrypoint

Establishes the single I/O boundary: `index.js` calls the pure renderer and writes the result to stdout once, ignoring all arguments and stdin, then exits 0 on natural completion. An integration test spawns the entrypoint as a real process to verify the run-once / exit-0 / args-ignored behavior.

**Task type:** code
**Requirements:** FR-4, FR-5, NFR-4, AD-3, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `index.js`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing entrypoint integration test (FR-4, FR-5)**
    Create `test/cli.test.js` with the content below. It runs `index.js` as a child process with the current Node binary; `execFileSync` throws on any non-zero exit, so a successful return proves the process exited 0. The first case asserts a colored banner is printed and the output ends with a newline; the second passes extra arguments to prove they are ignored and raise no error.
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');

    const ENTRY = path.join(__dirname, '..', 'index.js');

    test('entrypoint prints a colored banner and exits 0', () => {
      const out = execFileSync(process.execPath, [ENTRY], { encoding: 'utf8' });
      assert.match(out, /\x1b\[38;5;\d+m/);
      assert.ok(out.endsWith('\n'));
    });

    test('entrypoint ignores extra arguments without error', () => {
      const out = execFileSync(
        process.execPath,
        [ENTRY, '--word', 'foo', 'extra'],
        { encoding: 'utf8' },
      );
      assert.match(out, /\x1b\[38;5;\d+m/);
    });
    ```

- [ ] **Step 2: Run the entrypoint test and confirm it fails**
    Run: `node --test test/cli.test.js`
    Expected: FAIL — `index.js` does not exist yet, so the spawned process exits non-zero and `execFileSync` throws, failing both cases (FR-4)

- [ ] **Step 3: Implement the entrypoint (FR-4, FR-5, NFR-4, AD-3, AD-5)**
    Create `index.js` with exactly this content. It is the only module that writes to stdout: it requires the pure renderer, writes the banner once, and lets the process exit 0 on natural completion. It reads no argv and no stdin, so behavior is identical for any invocation, and the fixed small string makes the run effectively instantaneous.
    ```js
    'use strict';

    const { renderBanner } = require('./banner.js');

    // Ignore all argv and stdin; behavior is identical for any invocation.
    // Print the banner exactly once; the process exits 0 on natural completion.
    process.stdout.write(renderBanner());
    ```

- [ ] **Step 4: Run the entrypoint test and confirm it passes**
    Run: `node --test test/cli.test.js`
    Expected: PASS — the spawned process prints the colored banner, ignores the extra arguments, and exits 0 effectively instantly (FR-4, FR-5, NFR-4)
