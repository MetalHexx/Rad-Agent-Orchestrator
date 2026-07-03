---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 2
title: Build the rainbow banner renderer
status: pending
requirement_tags:
  - FR-1
  - FR-2
  - FR-3
  - FR-7
  - NFR-3
  - NFR-5
  - AD-1
  - AD-2
  - AD-3
  - AD-4
  - DD-1
  - DD-2
  - DD-3
  - DD-4
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:22:57.619Z'
type: task_handoff
---

# P01-T02: Build the rainbow banner renderer

Establishes the heart of the project: a pure function that assembles "HELLO WORLD" from a hardcoded blocky glyph map, colors each letter through the seven-color rainbow cycle with raw ANSI codes, and returns the finished multi-line string. The function is unit-tested in isolation, with no stdout capture required.

**Task type:** code
**Requirements:** FR-1, FR-2, FR-3, FR-7, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `banner.js`
- Test: `test/banner.test.js`

- [ ] **Step 1: Write the failing renderer test (FR-7, AD-3, AD-4, DD-4)**
    Create `test/banner.test.js` with the content below. It invokes the pure renderer directly (no process-output capture), asserting the banner row count matches the glyph height, that at least one ANSI color escape is present, and that the output has a single trailing newline with no leading blank line. The test uses the `node:test` runner and `node:assert` only.
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner, GLYPH_ROWS } = require('../banner.js');

    test('banner renders the expected number of ASCII-art rows', () => {
      const banner = renderBanner();
      const rows = banner.replace(/\n$/, '').split('\n');
      assert.strictEqual(rows.length, GLYPH_ROWS);
    });

    test('banner emits at least one ANSI color escape sequence', () => {
      const banner = renderBanner();
      assert.match(banner, /\x1b\[38;5;\d+m/);
    });

    test('banner has a single trailing newline and no leading blank line', () => {
      const banner = renderBanner();
      assert.ok(banner.endsWith('\n'));
      assert.ok(!banner.startsWith('\n'));
    });
    ```

- [ ] **Step 2: Run the renderer test and confirm it fails**
    Run: `node --test test/banner.test.js`
    Expected: FAIL — `banner.js` does not exist yet, so the `require('../banner.js')` resolution throws a module-not-found error (FR-7)

- [ ] **Step 3: Implement the pure renderer module (FR-1, FR-2, FR-3, NFR-3, NFR-5, AD-1, AD-2, AD-3, DD-1, DD-2, DD-3, DD-4)**
    Create `banner.js` with exactly this content. It stores the glyphs as a hardcoded per-character map of five row strings, defines the rainbow palette as raw ANSI 256-color SGR codes in red→orange→yellow→green→cyan→blue→purple order, colors letter N with palette index `N mod 7`, separates the two words with a fixed multi-space gap, resets color after every glyph segment, and returns a single string ending in one newline.
    ```js
    'use strict';

    // Hardcoded ASCII-art glyph map. Each glyph is exactly 5 rows tall.
    const GLYPHS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
    };

    const GLYPH_ROWS = 5;

    // Fixed rainbow palette as raw ANSI 256-color SGR codes,
    // ordered red, orange, yellow, green, cyan, blue, purple.
    const PALETTE = [
      '\x1b[38;5;196m', // red
      '\x1b[38;5;208m', // orange
      '\x1b[38;5;226m', // yellow
      '\x1b[38;5;46m',  // green
      '\x1b[38;5;51m',  // cyan
      '\x1b[38;5;21m',  // blue
      '\x1b[38;5;129m', // purple
    ];

    // Emitted after every colored glyph segment so color never bleeds
    // past the banner into the user's shell prompt.
    const RESET = '\x1b[0m';

    // Single-column separator between letters; wider gap between the two words.
    const LETTER_GAP = ' ';
    const WORD_GAP = '   ';

    const WORDS = ['HELLO', 'WORLD'];

    function renderBanner() {
      const lines = [];
      for (let row = 0; row < GLYPH_ROWS; row += 1) {
        let line = '';
        let letterIndex = 0;
        for (let w = 0; w < WORDS.length; w += 1) {
          const word = WORDS[w];
          for (let c = 0; c < word.length; c += 1) {
            if (c > 0) {
              line += LETTER_GAP;
            }
            const color = PALETTE[letterIndex % PALETTE.length];
            line += color + GLYPHS[word[c]][row] + RESET;
            letterIndex += 1;
          }
          if (w < WORDS.length - 1) {
            line += WORD_GAP;
          }
        }
        lines.push(line);
      }
      // Single trailing newline, no leading blank lines.
      return lines.join('\n') + '\n';
    }

    module.exports = { renderBanner, GLYPH_ROWS, PALETTE, RESET };
    ```

- [ ] **Step 4: Run the renderer test and confirm it passes**
    Run: `node --test test/banner.test.js`
    Expected: PASS — all three cases pass: five rows present, an ANSI color escape is found, and the trailing-newline/no-leading-blank shape holds (FR-1, FR-3, FR-7, DD-4)
