---
project: RAD-PLAN-BENCH
phase: 1
task: 2
title: Build glyph data and plain banner assembly
status: pending
requirement_tags:
  - FR-1
  - FR-3
  - FR-5
  - NFR-3
  - NFR-5
  - AD-2
  - AD-4
  - AD-5
  - DD-3
  - DD-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:18:41.578Z'
type: task_handoff
---

# P01-T02: Build glyph data and plain banner assembly

Render "HELLO WORLD" as fixed-height ASCII block letters assembled into centered
multi-line text. This task delivers the deterministic, dependency-free
rendering core and its first unit test, returned as a string from a dedicated
module.

**Task type:** code
**Requirements:** FR-1, FR-3, FR-5, NFR-3, NFR-5, AD-2, AD-4, AD-5, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `glyphs.js`
- Create: `render.js`
- Test: `render.test.js`

- [ ] **Step 1: Write the failing test (FR-1, FR-3, FR-5, AD-4, AD-5, DD-3)**
    Create `render.test.js` using Node's built-in runner (AD-5). It asserts the
    rendered banner has the fixed glyph height in rows (FR-1, DD-3), that the
    assembled rows carry the first letter's block shape (FR-1), and that the
    rendered banner is leading-padded for centering (FR-3). The module is
    imported as a returned string, requiring no process spawn (AD-4):
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner, assembleRows, GLYPH_HEIGHT } = require('./render');

    test('banner renders a fixed number of rows', () => {
      const lines = renderBanner().split('\n');
      assert.strictEqual(lines.length, GLYPH_HEIGHT);
    });

    test('assembled rows contain HELLO WORLD glyph content', () => {
      const rows = assembleRows('HELLO WORLD');
      assert.strictEqual(rows.length, GLYPH_HEIGHT);
      assert.ok(rows[0].includes('H   H'));
    });

    test('rendered banner is centered with leading padding', () => {
      const line = renderBanner().split('\n')[0];
      assert.ok(line.startsWith(' '), 'expected leading pad before glyphs');
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test render.test.js`
    Expected: FAIL — `Cannot find module './render'` because `render.js` does
    not exist yet (FR-1, FR-5).

- [ ] **Step 3: Implement the glyph data and assembly module (FR-1, FR-3, NFR-3, NFR-5, AD-2, AD-4, DD-3, DD-4)**
    Create `glyphs.js` holding hardcoded, in-repo block-letter data — no
    figlet or generator (AD-2) — with a uniform 5-row height and 5-column
    width per glyph so rendered rows align into clean bands (DD-3). Only the
    seven letters of "HELLO WORLD" plus space are needed (NFR-3):
    ```js
    'use strict';

    // Hardcoded block glyphs. Each glyph is 5 equal-width rows (DD-3).
    const GLYPHS = {
      H: ['H   H', 'H   H', 'HHHHH', 'H   H', 'H   H'],
      E: ['EEEEE', 'E    ', 'EEEE ', 'E    ', 'EEEEE'],
      L: ['L    ', 'L    ', 'L    ', 'L    ', 'LLLLL'],
      O: [' OOO ', 'O   O', 'O   O', 'O   O', ' OOO '],
      W: ['W   W', 'W   W', 'W W W', 'WW WW', 'W   W'],
      R: ['RRRR ', 'R   R', 'RRRR ', 'R  R ', 'R   R'],
      D: ['DDDD ', 'D   D', 'D   D', 'D   D', 'DDDD '],
      ' ': ['     ', '     ', '     ', '     ', '     '],
    };

    const GLYPH_HEIGHT = 5;
    const GLYPH_WIDTH = 5;

    module.exports = { GLYPHS, GLYPH_HEIGHT, GLYPH_WIDTH };
    ```
    Then create `render.js`, which assembles the fixed phrase row-by-row,
    centers each row using the detected terminal width with an 80-column
    fallback for non-TTY contexts (FR-3, DD-4), and returns the whole banner
    as a single string so a test can assert on it without spawning a process
    (AD-4). The work is synchronous and trivial, so it renders effectively
    instantly (NFR-5):
    ```js
    'use strict';

    const { GLYPHS, GLYPH_HEIGHT, GLYPH_WIDTH } = require('./glyphs');

    const WORD = 'HELLO WORLD';
    const COLUMN_GAP = 1;
    const FALLBACK_WIDTH = 80;

    function bannerWidth() {
      const count = WORD.length;
      return count * GLYPH_WIDTH + (count - 1) * COLUMN_GAP;
    }

    function assembleRows(word) {
      const rows = [];
      for (let r = 0; r < GLYPH_HEIGHT; r++) {
        const segments = [];
        for (const ch of word) {
          segments.push(GLYPHS[ch][r]);
        }
        rows.push(segments.join(' '.repeat(COLUMN_GAP)));
      }
      return rows;
    }

    function terminalWidth() {
      const cols = process.stdout && process.stdout.columns;
      return cols && cols > 0 ? cols : FALLBACK_WIDTH;
    }

    function centerRows(rows) {
      const pad = Math.max(0, Math.floor((terminalWidth() - bannerWidth()) / 2));
      const prefix = ' '.repeat(pad);
      return rows.map((row) => prefix + row);
    }

    function renderBanner() {
      return centerRows(assembleRows(WORD)).join('\n');
    }

    module.exports = { renderBanner, assembleRows, bannerWidth, WORD, GLYPH_HEIGHT };
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test render.test.js`
    Expected: PASS — all three assertions hold: the banner is 5 rows, the
    first row carries the `H` glyph shape, and each row is centered with
    leading padding (FR-1, FR-3, FR-5, AD-4, DD-3, DD-4).
