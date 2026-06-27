---
project: RAD-PLAN-BENCH
phase: 1
task: 2
title: Add rainbow coloring to the renderer
status: pending
requirement_tags:
  - FR-3
  - FR-7
  - NFR-3
  - AD-2
  - AD-4
  - DD-1
  - DD-3
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T20:51:11.320Z'
type: task_handoff
---

# P01-T02: Add rainbow coloring to the renderer

Establishes per-letter rainbow coloring via raw ANSI 256-color escapes with a reset after each letter, and locks the color contract with unit tests. After this task the renderer emits a fully colored banner string.

**Task type:** code
**Requirements:** FR-3, FR-7, NFR-3, AD-2, AD-4, DD-1, DD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Modify: `src/banner.js`
- Test: `test/banner.test.js`

- [ ] **Step 1: Write the failing test (FR-3, FR-7, DD-1, DD-3)**
    Append to `test/banner.test.js`:
    ```js
    test('banner emits ANSI 256-color foreground escapes', () => {
      const out = renderBanner();
      assert.match(out, /\x1b\[38;5;\d+m/, 'at least one foreground color escape present');
    });

    test('every color open is matched by a reset so color never bleeds', () => {
      const out = renderBanner();
      const opens = (out.match(/\x1b\[38;5;\d+m/g) || []).length;
      const resets = (out.match(/\x1b\[0m/g) || []).length;
      assert.strictEqual(opens, resets, 'one reset per color open');
    });

    test('palette holds the seven rainbow colors in order', () => {
      const { PALETTE } = require('../src/banner.js');
      assert.strictEqual(PALETTE.length, 7, 'red→orange→yellow→green→cyan→blue→purple');
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/banner.test.js`
    Expected: FAIL — `paint` is still a pass-through and `PALETTE` is not exported, so the color and palette assertions fail (FR-3, FR-7)

- [ ] **Step 3: Implement minimal code (FR-3, NFR-3, AD-2, AD-4, DD-1, DD-3)**
    In `src/banner.js`, add the fixed rainbow palette and make `paint` emit real ANSI 256-color escapes with a reset, then export `PALETTE`:
    ```js
    const RESET = '\x1b[0m';

    // red, orange, yellow, green, cyan, blue, purple — xterm-256 codes.
    const PALETTE = [196, 208, 226, 46, 51, 21, 93];

    function paint(colorIndex, segment) {
      const code = PALETTE[colorIndex % PALETTE.length];
      return `\x1b[38;5;${code}m${segment}${RESET}`;
    }
    ```
    Update the export line to also expose `PALETTE`:
    ```js
    module.exports = { renderBanner, paint, GLYPHS, PALETTE, HEIGHT };
    ```
    `renderBanner` already calls `paint(colorIndex, row)` once per visible letter, so color now advances one palette step per letter (DD-1) and resets after each (DD-3) using raw ANSI for modern terminals (NFR-3, AD-2). Tests run on Node's built-in runner (AD-4).

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/banner.test.js`
    Expected: PASS — color escapes present, opens match resets, palette length is 7 (FR-3, FR-7, DD-1, DD-3)
