---
project: RAD-PLAN-BENCH
phase: 2
task: 1
title: Wire CLI entrypoint and stdout output
status: pending
requirement_tags:
  - FR-3
  - FR-4
  - FR-6
  - NFR-3
  - NFR-4
  - NFR-5
  - AD-1
  - AD-3
  - DD-3
  - DD-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:48:06.163Z'
type: task_handoff
---

# P02-T01: Wire CLI entrypoint and stdout output

Build the thin I/O shell that composes the renderer and colorizer with chalk, centers the banner, and writes it to stdout with a single trailing newline before exiting. Chalk's auto color detection provides the plain-text fallback path.

**Task type:** code
**Requirements:** FR-3, FR-4, FR-6, NFR-3, NFR-4, NFR-5, AD-1, AD-3, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/render.js`
- Create: `index.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write the failing test (FR-3, FR-6, DD-3, DD-4)**
    Create `test/render.test.js` exercising the composition function that `index.js` will call:
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { buildBanner } from '../src/render.js';

    test('buildBanner returns a single trailing-newline string with no leading blank line (DD-4)', () => {
      const out = buildBanner({ color: false });
      assert.equal(typeof out, 'string');
      assert.ok(out.endsWith('\n'));
      assert.ok(!out.startsWith('\n'));
    });

    test('buildBanner({color:false}) contains the banner fill and no ANSI escapes (FR-6)', () => {
      const out = buildBanner({ color: false });
      assert.ok(out.includes('#'));
      assert.ok(!out.includes('['));
    });

    test('buildBanner({color:true}) injects ANSI escape codes (FR-2)', () => {
      const out = buildBanner({ color: true });
      assert.ok(out.includes('['));
    });
    ```
- [ ] **Step 2: Run test, confirm it fails (FR-3)**
    Run: `npm test -- test/render.test.js`
    Expected: FAIL — `src/render.js` does not exist yet (FR-3).
- [ ] **Step 3: Implement the composition module and entrypoint (FR-3, FR-4, FR-6, NFR-3, NFR-4, AD-1, AD-3, DD-3, DD-4)**
    Create `src/render.js` mapping the rainbow names to chalk and composing the pipeline (AD-3, DD-3, DD-4):
    ```js
    import { Chalk } from 'chalk';
    import { renderLetters, assembleRows, centerRows } from './banner.js';
    import { RAINBOW, colorLines } from './colorize.js';

    const TEXT = 'HELLO WORLD';
    const WIDTH = 80;

    // chalk color names; 'orange'/'purple' fall back to nearest chalk names.
    const CHALK_NAMES = {
      red: 'red', orange: 'yellow', yellow: 'yellow',
      green: 'green', cyan: 'cyan', blue: 'blue', purple: 'magenta',
    };

    export function buildBanner({ color } = {}) {
      const letters = renderLetters(TEXT);
      const useColor = color ?? true;
      let rows;
      if (useColor) {
        const chalk = new Chalk({ level: 1 });
        const palette = RAINBOW.map((name) => (s) => chalk[CHALK_NAMES[name]](s));
        rows = colorLines(letters, palette);
      } else {
        rows = assembleRows(letters);
      }
      return centerRows(rows, WIDTH).join('\n') + '\n';
    }
    ```
    Create `index.js` as the thin shell that runs once and exits (AD-1, FR-3, FR-4, NFR-4):
    ```js
    import { buildBanner } from './src/render.js';

    // Ignore any args (FR-4); chalk auto-detects color support for the live stream (FR-6).
    const supportsColor = process.stdout.isTTY === true;
    process.stdout.write(buildBanner({ color: supportsColor }));
    process.exit(0);
    ```
- [ ] **Step 4: Run test, confirm pass (FR-3, FR-6, NFR-5)**
    Run: `npm test -- test/render.test.js`
    Expected: PASS — colored and plain composition both behave; output ends in one newline (FR-3, FR-6, NFR-5).
