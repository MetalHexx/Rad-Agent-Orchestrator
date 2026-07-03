---
project: RAD-PLAN-BENCH
phase: 2
task: 2
title: Wire the one-shot entrypoint
status: pending
requirement_tags:
  - FR-2
  - FR-3
  - FR-5
  - NFR-2
  - AD-1
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:35:15.252Z'
type: task_handoff
---

# P02-T02: Wire the one-shot entrypoint

Delivers `index.js`, the composing entrypoint that reads the terminal width, prints the centered rainbow banner once, and lets the process exit 0 without looping or waiting. A spawned smoke test proves the full `node index.js` path renders a multi-line colored banner.

**Task type:** code
**Requirements:** FR-2, FR-3, FR-5, NFR-2, AD-1
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `index.js`
- Test: `test/index.test.js`

- [ ] **Step 1: Write the failing test (FR-3, FR-5, FR-2)**
    Create `test/index.test.js`. It spawns the entrypoint with `FORCE_COLOR=3` so chalk emits escapes through the pipe, asserts the process exits 0 (a non-zero exit makes `execFileSync` throw), and asserts the output is a multi-line colored banner (FR-3, FR-5, FR-2).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert';
    import { execFileSync } from 'node:child_process';
    import { fileURLToPath } from 'node:url';

    const entrypoint = fileURLToPath(new URL('../index.js', import.meta.url));

    test('node index.js prints a multi-line colored banner and exits 0', () => {
      const output = execFileSync('node', [entrypoint], {
        env: { ...process.env, FORCE_COLOR: '3' },
        encoding: 'utf8',
      });
      const lines = output.replace(/\n$/, '').split('\n');
      assert.strictEqual(lines.length, 5);
      assert.match(output, /\[/);
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/index.test.js`
    Expected: FAIL — `index.js` does not exist yet, so `node index.js` exits non-zero and `execFileSync` throws (FR-3, FR-5).

- [ ] **Step 3: Implement the entrypoint (FR-3, FR-5, FR-2, NFR-2, AD-1)**
    Create `index.js` as the single composing entrypoint (AD-1). It reads `process.stdout.columns` (undefined off a TTY, where centering falls back), writes the centered rainbow banner once (FR-2, FR-5), and returns so the process exits 0 naturally without an explicit `process.exit`, ensuring buffered stdout flushes and nothing stays resident (FR-3). Chalk inside the banner pipeline handles graceful color degradation off a TTY (NFR-2).
    ```js
    import { centerBanner } from './src/banner.js';

    const TEXT = 'HELLO WORLD';

    function main() {
      const lines = centerBanner(TEXT, process.stdout.columns);
      process.stdout.write(lines.join('\n') + '\n');
    }

    main();
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/index.test.js`
    Expected: PASS — the spawned `node index.js` exits 0 and prints a five-line banner containing color escapes (FR-3, FR-5, FR-2).
