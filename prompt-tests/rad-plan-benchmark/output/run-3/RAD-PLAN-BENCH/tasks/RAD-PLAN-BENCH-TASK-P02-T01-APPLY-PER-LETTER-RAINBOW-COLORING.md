---
project: RAD-PLAN-BENCH
phase: 2
task: 1
title: Apply per-letter rainbow coloring
status: pending
requirement_tags:
  - FR-2
  - FR-5
  - NFR-2
  - AD-3
  - AD-5
  - DD-1
  - DD-2
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:18:41.578Z'
type: task_handoff
---

# P02-T01: Apply per-letter rainbow coloring

Color the banner so each visible letter advances one step through a looping
rainbow spectrum, producing a multicolored banner that renders across platforms.
This task delivers the color pass and the test that asserts ANSI escapes are
present.

**Task type:** code
**Requirements:** FR-2, FR-5, NFR-2, AD-3, AD-5, DD-1, DD-2
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Modify: `render.js`
- Test: `render.test.js`

- [ ] **Step 1: Write the failing test (FR-2, FR-5, DD-1, DD-2)**
    Append two assertions to `render.test.js`: the rendered banner contains
    ANSI color escape sequences (FR-2, FR-5), and it uses multiple distinct
    color codes so the rainbow is visibly multicolored across letters (DD-1,
    DD-2):
    ```js
    test('banner output includes ANSI color escape sequences', () => {
      const out = renderBanner();
      assert.match(out, /\[/);
    });

    test('rainbow uses multiple distinct colors across letters', () => {
      const out = renderBanner();
      const codes = new Set(out.match(/\[[0-9;]*m/g));
      assert.ok(codes.size >= 3, `expected >= 3 distinct color codes, got ${codes.size}`);
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test render.test.js`
    Expected: FAIL — the new assertions fail because `render.js` still emits
    plain, uncolored rows with no ANSI escape sequences (FR-2, FR-5).

- [ ] **Step 3: Add the rainbow color pass (FR-2, NFR-2, AD-3, DD-1, DD-2)**
    Modify `render.js` to color each visible letter through `chalk`, the single
    permitted dependency that normalizes ANSI handling across platforms
    including Windows (AD-3, NFR-2). Use a forced `chalk` instance so color is
    emitted even in non-TTY/CI contexts. Define the spectrum in the order
    red → orange → yellow → green → cyan → blue → purple, looping back to red
    (DD-1), and advance one color per visible letter while skipping the space
    (DD-2). Add the import and palette near the top of `render.js`:
    ```js
    const chalk = require('chalk');

    // Force at least 16-color output so the banner is always colorful (NFR-2).
    const ink = new chalk.Instance({ level: Math.max(chalk.level, 1) });

    // Rainbow order: red, orange, yellow, green, cyan, blue, purple (DD-1).
    const PALETTE = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#8B00FF'];

    function colorForLetter(letterIndex) {
      return PALETTE[letterIndex % PALETTE.length];
    }
    ```
    Then replace the `assembleRows` function so each non-space letter's
    row-segment is wrapped in its rainbow color and the space stays uncolored,
    advancing the color index only on visible letters (DD-2). Centering math is
    unchanged because it derives from the fixed glyph width, not the colored
    string length:
    ```js
    function assembleRows(word) {
      const rows = [];
      for (let r = 0; r < GLYPH_HEIGHT; r++) {
        const segments = [];
        let letterIndex = 0;
        for (const ch of word) {
          const cell = GLYPHS[ch][r];
          if (ch === ' ') {
            segments.push(cell);
          } else {
            segments.push(ink.hex(colorForLetter(letterIndex))(cell));
            letterIndex++;
          }
        }
        rows.push(segments.join(' '.repeat(COLUMN_GAP)));
      }
      return rows;
    }
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test render.test.js`
    Expected: PASS — every test passes, including the original row-count and
    centering checks plus the new ANSI-presence and multi-color checks, since
    each letter is wrapped in a distinct rainbow color (FR-2, FR-5, NFR-2,
    AD-3, DD-1, DD-2).
