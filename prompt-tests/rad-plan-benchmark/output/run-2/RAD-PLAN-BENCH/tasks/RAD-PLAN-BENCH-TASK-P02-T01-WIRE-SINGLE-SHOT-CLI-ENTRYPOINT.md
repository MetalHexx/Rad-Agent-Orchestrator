---
project: RAD-PLAN-BENCH
phase: 2
task: 1
title: Wire single-shot CLI entrypoint
status: pending
requirement_tags:
  - FR-3
  - FR-4
  - AD-3
  - AD-5
  - DD-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:18:51.301Z'
type: task_handoff
---

# P02-T01: Wire single-shot CLI entrypoint

Create the `index.js` entrypoint that renders the banner once, writes it to stdout in one synchronous pass, and exits — no argument parsing, no config, no persistent state. An automated subprocess test confirms the single-shot run produces a colored, multi-line banner and exits cleanly.

**Task type:** code
**Requirements:** FR-3, FR-4, AD-3, AD-5, DD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `index.js`
- Test: `cli.test.js`

- [ ] **Step 1: Write the failing CLI integration test**
    Create `cli.test.js` with the case below. It spawns `node index.js` (with `FORCE_COLOR=1` so the child process emits ANSI deterministically), and asserts the run exits cleanly, prints a non-empty multi-line banner, and includes color escapes — verifying the single-shot invocation end to end (FR-3, FR-4).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { fileURLToPath } from 'node:url';
    import { dirname } from 'node:path';

    const here = dirname(fileURLToPath(import.meta.url));

    test('CLI prints a colored multi-line banner and exits cleanly', () => {
      const out = execFileSync('node', ['index.js'], {
        cwd: here,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '1' },
      });
      const lines = out.split('\n');
      assert.ok(lines.length >= 6, 'banner spans multiple lines');
      assert.ok(out.trim().length > 0, 'banner is non-empty');
      assert.match(out, /\[/);
    });
    ```
    Note: `execFileSync` throws on a non-zero exit code, so a clean success exit is asserted implicitly by the call not throwing (FR-3).

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test cli.test.js`
    Expected: FAIL — `index.js` does not yet exist, so the spawned `node index.js` exits non-zero and `execFileSync` throws (FR-3, FR-4).

- [ ] **Step 3: Implement the single-shot entrypoint**
    Create `index.js` exactly as below. It imports the finished `renderBanner`, writes the banner plus a trailing newline to stdout in one synchronous pass, and falls off the end so the process exits cleanly. It reads no arguments, no config, and holds no state (AD-5), and produces a single static frame with no animation or redraw (DD-4). This shares the one code path used by both `node index.js` and `npm start` (AD-3, FR-3).
    ```js
    import { renderBanner } from './banner.js';

    process.stdout.write(renderBanner() + '\n');
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test cli.test.js`
    Expected: PASS — the spawned single-shot run exits 0 and prints a non-empty, multi-line, ANSI-colored banner (FR-3, FR-4, DD-4).
