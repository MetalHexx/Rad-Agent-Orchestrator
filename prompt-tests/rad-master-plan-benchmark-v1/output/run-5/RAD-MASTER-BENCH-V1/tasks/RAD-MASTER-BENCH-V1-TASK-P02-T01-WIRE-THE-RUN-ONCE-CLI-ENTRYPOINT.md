---
project: RAD-MASTER-BENCH-V1
phase: 2
task: 1
title: Wire the run-once CLI entrypoint
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
created: '2026-06-29T21:19:55.172Z'
type: task_handoff
---

# P02-T01: Wire the run-once CLI entrypoint

Establishes the thin `index.js` entrypoint — the only module that writes to stdout — which calls the pure renderer once, prints the banner, ignores any arguments, reads no stdin, and exits with status 0. An integration test spawns the process to confirm the run-once, argument-agnostic behavior.

**Task type:** code
**Requirements:** FR-4, FR-5, NFR-4, AD-3, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `index.js`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing test (FR-4, FR-5)**
    Create `test/cli.test.js` that spawns the entrypoint as a child process; `execFileSync` throws on a non-zero exit, so a successful call confirms exit 0, and passing extra arguments confirms they are ignored:
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');

    const ENTRY = path.join(__dirname, '..', 'index.js');

    test('entrypoint prints the banner and exits 0 even with extra arguments', () => {
      const output = execFileSync(process.execPath, [ENTRY, '--unused', 'ignored'], {
        encoding: 'utf8',
      });
      const lines = output.replace(/\n$/, '').split('\n');
      assert.strictEqual(lines.length, 5);
      assert.match(output, /\x1b\[38;5;\d+m/);
      assert.ok(output.endsWith('\n'));
    });

    test('entrypoint output is identical across runs and reads no stdin', () => {
      const first = execFileSync(process.execPath, [ENTRY], { encoding: 'utf8' });
      const second = execFileSync(process.execPath, [ENTRY], { encoding: 'utf8' });
      assert.strictEqual(first, second);
    });
    ```
- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test test/cli.test.js`
    Expected: FAIL — `execFileSync` throws `ENOENT` because `index.js` does not exist yet (FR-4)
- [ ] **Step 3: Implement the entrypoint (FR-4, FR-5, NFR-4, AD-3, AD-5)**
    Create `index.js` that requires the renderer and writes the banner once to stdout; it reads no `process.argv` and no stdin, and lets the process exit naturally with status 0 after the write drains:
    ```js
    #!/usr/bin/env node
    'use strict';

    const { renderBanner } = require('./renderer');

    process.stdout.write(renderBanner());
    ```
- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test test/cli.test.js`
    Expected: PASS — the entrypoint prints the banner once and exits 0 regardless of arguments, completing effectively instantly (FR-4, FR-5, NFR-4)
