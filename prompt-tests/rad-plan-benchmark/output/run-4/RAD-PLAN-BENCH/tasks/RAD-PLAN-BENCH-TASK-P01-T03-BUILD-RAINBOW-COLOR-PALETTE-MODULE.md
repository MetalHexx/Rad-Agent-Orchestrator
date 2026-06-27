---
project: RAD-PLAN-BENCH
phase: 1
task: 3
title: Build rainbow color palette module
status: pending
requirement_tags:
  - FR-2
  - NFR-2
  - AD-2
  - DD-1
  - DD-3
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:35:15.252Z'
type: task_handoff
---

# P01-T03: Build rainbow color palette module

Delivers the spectral color palette and a per-index color selector built on `chalk`, so adjacent letters render as distinct hues that wrap after seven colors. Color is applied via chalk so it degrades gracefully off a TTY.

**Task type:** code
**Requirements:** FR-2, NFR-2, AD-2, DD-1, DD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/colors.js`
- Test: `test/colors.test.js`

- [ ] **Step 1: Write the failing test (FR-2, DD-1, AD-2)**
    Create `test/colors.test.js`. It forces chalk's color level on so escape sequences are emitted in the non-TTY test process, then asserts the palette has seven spectral hues, wraps at the boundary, and produces distinct, escaped output per index (FR-2, DD-1, AD-2).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert';
    import chalk from 'chalk';

    chalk.level = 3;

    const { RAINBOW, colorForIndex } = await import('../src/colors.js');

    test('palette holds seven spectral hues and wraps', () => {
      assert.strictEqual(RAINBOW.length, 7);
      assert.strictEqual(colorForIndex(0), colorForIndex(7));
    });

    test('each index paints a distinct, escaped string', () => {
      const first = colorForIndex(0)('X');
      const second = colorForIndex(1)('X');
      assert.match(first, /\[/);
      assert.notStrictEqual(first, second);
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/colors.test.js`
    Expected: FAIL — `src/colors.js` does not exist yet, so the dynamic import rejects (FR-2).

- [ ] **Step 3: Implement the palette and selector (FR-2, NFR-2, AD-2, DD-1, DD-3)**
    Create `src/colors.js` exposing the spectral palette in order red, orange, yellow, green, cyan, blue, purple, and a selector that wraps modulo the palette length. Color flows through chalk, which detects terminal capability and disables color off a TTY (AD-2, NFR-2); the spectral order and wrap satisfy DD-1; returning a whole-string painter supports per-letter coloring (DD-3) and FR-2.
    ```js
    import chalk from 'chalk';

    export const RAINBOW = [
      chalk.red,
      chalk.hex('#FFA500'),
      chalk.yellow,
      chalk.green,
      chalk.cyan,
      chalk.blue,
      chalk.magenta,
    ];

    export function colorForIndex(index) {
      return RAINBOW[index % RAINBOW.length];
    }
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/colors.test.js`
    Expected: PASS — the palette has seven hues, `colorForIndex(0)` and `colorForIndex(7)` are the same painter, and adjacent indices emit distinct escaped strings (FR-2, DD-1, AD-2).
